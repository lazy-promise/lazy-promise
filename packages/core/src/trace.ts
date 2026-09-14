import type { LazyPromise, Subscription } from "./lazyPromise.js";
import { throwInMicrotask } from "./utils.js";

/**
 * Observes a single subscription. Returned by `Tracer.subscribe`.
 */
export interface Span<Value, Dep = unknown> {
  /**
   * Wraps synchronous work done on behalf of the subscription: running the
   * producer, the consumer handlers, or the teardown logic. Must call `work`
   * exactly once.
   */
  run?(work: () => void): void;
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

/**
 * Linked list of spans whose `run` is on the stack, innermost first.
 */
export let activeSpans: SpanNode | undefined;

const runSpan = (span: Span<any>, work: () => void) => {
  if (!span.run) {
    work();
    return;
  }
  const frame = new SpanNode(span, activeSpans);
  activeSpans = frame;
  let called = false;
  const guardedWork = () => {
    if (called) {
      return;
    }
    called = true;
    work();
  };
  try {
    span.run(guardedWork);
  } catch (error) {
    throwInMicrotask(error);
  } finally {
    activeSpans = frame.next;
  }
  // In case the tracer failed to call it.
  guardedWork();
};

/**
 * Runs `work` inside the `run` methods of the spans in the `node` linked list
 * up to and excluding `end`, with `node` innermost in the stack.
 */
export const runSpans = (
  node: SpanNode | undefined,
  end: SpanNode | undefined,
  work: () => void,
): void => {
  if (node === end) {
    work();
    return;
  }
  runSpans(node!.next, end, () => {
    runSpan(node!.span, work);
  });
};

/**
 * For each span in the `node` linked list, calls `notify` and then runs the
 * rest inside the span's `run` method, finishing with `work`, so that `node`
 * is outermost in the stack.
 */
export const settleSpans = (
  node: SpanNode | undefined,
  notify: (span: Span<any>) => void,
  work: () => void,
): void => {
  if (!node) {
    work();
    return;
  }
  try {
    notify(node.span);
  } catch (error) {
    throwInMicrotask(error);
  }
  runSpan(node.span, () => {
    settleSpans(node.next, notify, work);
  });
};

/**
 * Same as `settleSpans` with `unsubscribe` as the notification, except that
 * the last node of the list is outermost in the stack.
 */
export const unsubscribeSpans = (
  node: SpanNode | undefined,
  work: () => void,
): void => {
  if (!node) {
    work();
    return;
  }
  unsubscribeSpans(node.next, () => {
    try {
      node.span.unsubscribe?.();
    } catch (error) {
      throwInMicrotask(error);
    }
    runSpan(node.span, work);
  });
};

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
