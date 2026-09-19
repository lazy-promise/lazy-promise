import type { AsyncContextResource } from "./asyncResource.js";
import type { LazyPromise, Subscription } from "./lazyPromise.js";

/**
 * Observes a single subscription. Returned by `Tracer.subscribe`.
 */
export interface Span<Value, Dep = unknown> {
  /**
   * Wraps synchronous work done on behalf of the subscription: running the
   * producer, the consumer handlers, or the teardown logic. Must call `work`
   * exactly once. `depth` is the number of `run` calls that logically enclose
   * the work, counting this one; `log` prints that many dots.
   */
  run?(work: () => void, depth: number): void;
  resolve?(value: Value): void;
  reject?(error: unknown): void;
  /**
   * Called when the producer resolves with a LazyPromise.
   */
  flatten?(lazyPromise: LazyPromise<Value, Dep>): void;
  unsubscribe?(): void;
}

export class SpanNode {
  constructor(
    public span: Span<any>,
    public next: SpanNode | undefined,
  ) {}
}

export const reverseSpans = (
  node: SpanNode | undefined,
): SpanNode | undefined => {
  let reversed: SpanNode | undefined;
  while (node) {
    const next = node.next;
    node.next = reversed;
    reversed = node;
    node = next;
  }
  return reversed;
};

/**
 * A `run` call, either on the stack or to be re-entered.
 */
export class Frame {
  constructor(
    public span: Span<any>,
    public depth: number,
  ) {}
}

/**
 * The frame of the innermost `run` call on the stack.
 */
export let activeFrame: Frame | undefined;

/**
 * Calls the frame's `run`. Also used to re-enter the active frame after the
 * library has restored the async context of `subscribe`, so that the context
 * set up by `run` wins over the restored one.
 */
export const runFrame = (frame: Frame, work: () => void): void => {
  const previousFrame = activeFrame;
  activeFrame = frame;
  frame.span.run!(work, frame.depth);
  activeFrame = previousFrame;
};

/**
 * Runs `work` inside `frame`, re-entering the frame's `run` if the frame is
 * not the active one.
 */
export const runInFrame = (
  frame: Frame | undefined,
  work: () => void,
): void => {
  if (frame === activeFrame) {
    work();
    return;
  }
  runFrame(frame!, work);
};

/**
 * Visits the nodes from `node` up to `end`, then does `work`, all inside
 * `baseFrame`. Each visited span that has `run` wraps what follows it, up to
 * and including the visit that yields the next such span, so that the `run`
 * calls are siblings rather than nested.
 *
 * The notifications preceding the first `run` call happen in the async
 * context of whatever caused them; `asyncResource`, if provided, restores the
 * context of `subscribe` for the `run` calls and the work.
 */
export class Chain<Node extends { next: Node | undefined }> {
  // The span whose `run` is to wrap the next step.
  span: Span<any> | undefined;
  // The base frame, re-entered after the context of `subscribe` is restored.
  frame: Frame | undefined;
  depth = 0;
  asyncResource: AsyncContextResource | undefined;

  constructor(
    public node: Node | undefined,
    public end: Node | undefined,
    public visit: (node: Node) => Span<any> | void,
    public work: () => void,
  ) {}

  run(baseFrame: Frame | undefined, asyncResource?: AsyncContextResource) {
    this.frame = baseFrame;
    this.depth = baseFrame ? baseFrame.depth : 0;
    this.asyncResource = asyncResource;
    runInFrame(baseFrame, this.start);
  }

  start = () => {
    this.advance();
    if (this.asyncResource) {
      this.asyncResource.runInAsyncScope(this.finishInFrame, undefined);
    } else {
      this.finish();
    }
  };

  finishInFrame = () => {
    if (this.frame) {
      runFrame(this.frame, this.finish);
    } else {
      this.finish();
    }
  };

  finish = () => {
    if (!this.span) {
      this.work();
    }
    while (this.span) {
      runFrame(new Frame(this.span, ++this.depth), this.step);
    }
  };

  step = () => {
    this.advance();
    if (!this.span) {
      this.work();
    }
  };

  advance() {
    while (this.node !== this.end) {
      const node = this.node!;
      this.node = node.next;
      const span = this.visit(node);
      if (span && span.run) {
        this.span = span;
        return;
      }
    }
    this.span = undefined;
  }
}

/**
 * Attached to a LazyPromise using its `trace` method.
 */
export interface Tracer<Value, Dep = unknown> {
  /**
   * Called when the LazyPromise is subscribed, before the producer runs.
   */
  subscribe(dep: Dep, subscription: Subscription): Span<Value, Dep> | void;
}

/**
 * Returned by `LazyPromise.prototype.trace`.
 */
export class Tracing {
  /** @internal */
  // eslint-disable-next-line no-use-before-define
  previous: Tracing | undefined;
  /** @internal */
  // eslint-disable-next-line no-use-before-define
  next: Tracing | undefined;
  /** @internal */
  lazyPromise: LazyPromise<any, any> | undefined;

  /** @internal */
  constructor(
    /** @internal */
    public tracer: Tracer<any, any>,
    lazyPromise: LazyPromise<any, any>,
  ) {
    this.lazyPromise = lazyPromise;
    this.next = lazyPromise.tracers;
    if (this.next) {
      this.next.previous = this;
    }
    lazyPromise.tracers = this;
  }

  /**
   * Detaches the tracer. Spans that have already been created are unaffected.
   */
  dispose() {
    const lazyPromise = this.lazyPromise;
    if (!lazyPromise) {
      return;
    }
    this.lazyPromise = undefined;
    if (this.previous) {
      this.previous.next = this.next;
    } else {
      lazyPromise.tracers = this.next;
    }
    if (this.next) {
      this.next.previous = this.previous;
    }
  }
}
