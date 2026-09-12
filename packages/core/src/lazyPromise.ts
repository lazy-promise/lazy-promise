import { CatchProducer } from "./catch.js";
import { CatchBoxedProducer } from "./catchBoxed.js";
import { FinallyProducer } from "./finally.js";
import { InjectProducer } from "./inject.js";
import { MapProducer } from "./map.js";
import { ToEagerConsumerListener } from "./toEager.js";
import { throwInMicrotask } from "./utils.js";

export class ErrorBox<const Error> {
  constructor(public readonly error: Error) {}
  declare private brand: any;
}

export type UnboxError<T> = T extends ErrorBox<infer Error> ? Error : never;

/**
 * Observes a single subscription. Returned by `Tracer.subscribe`.
 */
export interface Span<Value> {
  /**
   * Wraps synchronous work done on behalf of the subscription: running the
   * producer, the consumer handlers, or the teardown logic. Must call `work`
   * exactly once.
   */
  run?(work: () => void): void;
  resolve?(value: Value): void;
  reject?(error: unknown): void;
  unsubscribe?(): void;
}

class SpanNode {
  constructor(
    public span: Span<any>,
    public next: SpanNode | undefined,
  ) {}
}

/**
 * Linked list of spans whose `run` is on the stack, innermost first.
 */
let activeSpans: SpanNode | undefined;

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
const runSpans = (
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
const settleSpans = (
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
const unsubscribeSpans = (
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
 * Attached to a LazyPromise with its `trace` method.
 */
export interface Tracer<Value, Dep = unknown> {
  /**
   * Called when the LazyPromise is subscribed, before the producer runs.
   */
  // eslint-disable-next-line no-use-before-define
  subscribe(dep: Dep, subscription: Subscription): Span<Value> | void;
}

/**
 * Returned by `LazyPromise.prototype.trace`.
 */
class Tracing {
  /** @internal */
  // eslint-disable-next-line no-use-before-define
  previous: Tracing | undefined;

  /** @internal */
  constructor(
    /** @internal */
    public tracer: Tracer<any, any>,
    /** @internal */
    public lazyPromise: LazyPromise<any, any> | undefined, // eslint-disable-line no-use-before-define
    /** @internal */
    public next: Tracing | undefined,
  ) {}

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

export type { Tracing };

/**
 * What the next producer run of a subscription needs for tracing: tracers of
 * the LazyPromise whose producer it is, and spans that were active when it was
 * scheduled.
 */
class PendingTrace {
  constructor(
    public tracers: Tracing | undefined,
    public activeSpans: SpanNode | undefined,
  ) {}
}

export type Yieldable = {
  [`❌ Did you forget a star (*) after yield?`]: never;
};

class LazyPromiseIterator<TYield> implements Iterator<TYield> {
  done = false;

  constructor(public yieldable: TYield) {}

  next(value: any): IteratorResult<TYield> {
    if (this.done) {
      return {
        value,
        done: true,
      };
    }
    this.done = true;
    return {
      value: this.yieldable,
      done: false,
    };
  }

  throw(error: unknown): IteratorResult<TYield> {
    throw error;
  }
}

export interface Consumer<Value> {
  resolve?: (value: Value) => void;
  reject?: (error: unknown) => void;
}

class Sink<in Value, out Dep = unknown> {
  /** @internal */
  resolvedWithAPromise: boolean = false;

  /** @internal */
  constructor(
    /** @internal */
    // eslint-disable-next-line no-use-before-define
    public subscription: Subscription,
  ) {}

  resolve(
    this: Sink<Value, Dep>,
    // eslint-disable-next-line no-use-before-define
    value: Value | LazyPromise<Value, Dep>,
  ) {
    if (this.resolvedWithAPromise) {
      return;
    }
    const subscription = this.subscription;
    if (subscription.disposed || subscription.settled) {
      return;
    }
    // eslint-disable-next-line no-use-before-define
    if (value instanceof LazyPromise) {
      this.resolvedWithAPromise = true;
      if (value.tracers || activeSpans) {
        subscription.pendingTrace = new PendingTrace(
          value.tracers,
          activeSpans,
        );
      }
      if (subscription.producer) {
        // Use the while loop to avoid increasing stack depth.
        subscription.producer = value.producer;
        return;
      }
      subscription.producer = value.producer;
      subscription.job = undefined;
      subscription.next();
      return;
    }
    subscription.resolve(value);
  }

  reject(this: Sink<Value, Dep>, error: unknown) {
    if (this.resolvedWithAPromise) {
      return;
    }
    const subscription = this.subscription;
    if (subscription.disposed || subscription.settled) {
      return;
    }
    subscription.reject(error);
  }
}

export type { Sink };

export interface Job {
  dispose(): void;
}

class Subscription {
  /** @internal */
  job: (() => void) | Job | void | undefined;
  /** @internal */
  settled: boolean = false;
  /** @internal */
  disposed: boolean = false;
  /** @internal */
  spans: SpanNode | undefined;
  /** @internal */
  pendingTrace: PendingTrace | undefined;

  /** @internal */
  constructor(
    /** @internal */
    public producer?:
      | ((sink: Sink<any, any>, dep: any) => (() => void) | Job | void)
      // eslint-disable-next-line no-use-before-define
      | Producer<any, any>,
    /** @internal */
    public consumer?: {
      resolve?: (value: any) => void;
      reject?: (error: unknown) => void;
    },
    /** @internal */
    public dep?: any,
  ) {}

  // Methods that run when there is no tracing must not contain closures (even
  // ones that are never created) because that would make V8 allocate a context
  // on every call. That's why the `...Traced` methods are separate.

  /** @internal */
  next() {
    const baseSpans = activeSpans;
    let sink: Sink<any, any>;
    do {
      sink = new Sink(this);
      if (this.pendingTrace) {
        this.runProducerTraced(sink, baseSpans);
      } else {
        this.runProducer(sink);
      }
    } while (sink.resolvedWithAPromise);
  }

  /** @internal */
  runProducerTraced(sink: Sink<any, any>, baseSpans: SpanNode | undefined) {
    const pendingTrace = this.pendingTrace!;
    this.pendingTrace = undefined;
    runSpans(pendingTrace.activeSpans, baseSpans, () => {
      const previousSpans = this.spans;
      this.subscribeTracers(pendingTrace.tracers);
      runSpans(this.spans, previousSpans, () => {
        this.runProducer(sink);
      });
    });
  }

  /** @internal */
  subscribeTracers(tracers: Tracing | undefined) {
    for (let tracing = tracers; tracing; tracing = tracing.next) {
      let span;
      try {
        span = tracing.tracer.subscribe(this.dep, this);
      } catch (error) {
        throwInMicrotask(error);
      }
      if (span) {
        this.spans = new SpanNode(span, this.spans);
      }
    }
  }

  /** @internal */
  runProducer(sink: Sink<any, any>) {
    try {
      const job =
        typeof this.producer === "function"
          ? (0, this.producer)(sink, this.dep)
          : this.producer!.produce(sink, this.dep);
      if (sink.resolvedWithAPromise) {
        return;
      }
      this.producer = undefined;
      if (this.settled) {
        return;
      }
      this.job = job;
      if (this.disposed) {
        this.disposeJob();
      }
    } catch (error) {
      if (sink.resolvedWithAPromise) {
        return;
      }
      // For GC purposes.
      this.producer = undefined;
      sink.reject(error);
    }
  }

  /** @internal */
  resolve(value: any) {
    this.settled = true;
    // For GC purposes.
    this.dep = undefined;
    // For GC purposes.
    this.job = undefined;
    if (this.spans) {
      this.resolveTraced(value);
    } else {
      this.consumeValue(value);
    }
  }

  /** @internal */
  resolveTraced(value: any) {
    const spans = this.spans;
    this.spans = undefined;
    settleSpans(
      spans,
      (span) => {
        span.resolve?.(value);
      },
      () => {
        this.consumeValue(value);
      },
    );
  }

  /** @internal */
  reject(error: unknown) {
    this.settled = true;
    // For GC purposes.
    this.dep = undefined;
    // For GC purposes.
    this.job = undefined;
    if (this.spans) {
      this.rejectTraced(error);
    } else {
      this.consumeError(error);
    }
  }

  /** @internal */
  rejectTraced(error: unknown) {
    const spans = this.spans;
    this.spans = undefined;
    settleSpans(
      spans,
      (span) => {
        span.reject?.(error);
      },
      () => {
        this.consumeError(error);
      },
    );
  }

  /** @internal */
  consumeValue(value: any) {
    const consumer = this.consumer;
    // For GC purposes.
    this.consumer = undefined;
    if (consumer?.resolve) {
      try {
        consumer.resolve(value);
      } catch (error) {
        throwInMicrotask(error);
      }
    }
  }

  /** @internal */
  consumeError(error: unknown) {
    const consumer = this.consumer;
    // For GC purposes.
    this.consumer = undefined;
    if (consumer?.reject) {
      try {
        consumer.reject(error);
      } catch (error) {
        throwInMicrotask(error);
      }
    } else {
      throwInMicrotask(error);
    }
  }

  dispose() {
    if (this.settled || this.disposed) {
      return;
    }
    this.disposed = true;
    // For GC purposes.
    this.consumer = undefined;
    // For GC purposes.
    this.dep = undefined;
    if (this.spans) {
      this.disposeTraced();
    } else {
      this.disposeJob();
    }
  }

  /** @internal */
  disposeTraced() {
    const spans = this.spans;
    this.spans = undefined;
    unsubscribeSpans(spans, () => {
      this.disposeJob();
    });
  }

  /** @internal */
  disposeJob() {
    const job = this.job;
    if (!job) {
      return;
    }
    // For GC purposes.
    this.job = undefined;
    try {
      typeof job === "function" ? job() : job.dispose();
    } catch (error) {
      throwInMicrotask(error);
    }
  }
}

export type { Subscription };

export interface Producer<Value, Dep = unknown> {
  produce: (sink: Sink<Value, Dep>, dep: Dep) => (() => void) | Job | void;
}

/**
 * A Promise-like primitive which is lazy, cancelable, and emits synchronously
 * instead of in a microtask.
 *
 * The first type parameter `Value` represents the values that the LazyPromise
 * can resolve to.
 *
 * The second type parameter `Dep` represents the dependency that the
 * LazyPromise needs to be provided when it's subscribed. By default `Dep` is
 * `unknown`, indicating that no dependency is required.
 */
export class LazyPromise<out Value, in Dep = unknown> {
  /** @internal */
  public producer:
    | ((sink: Sink<Value, Dep>, dep: Dep) => (() => void) | Job | void)
    | Producer<Value, Dep>;
  /** @internal */
  tracers: Tracing | undefined;

  constructor(
    producer:
      | ((sink: Sink<Value, Dep>, dep: Dep) => (() => void) | Job | void)
      | Producer<Value, Dep>,
  ) {
    this.producer = producer;
  }

  /**
   * Subscribes to the LazyPromise.
   *
   * The type parameter `WhitelistedError` is used to constrain the type of
   * boxed errors that the promise is allowed to resolve to. If you do not
   * expect  _any_ boxed errors, just omit the type parameter so it would
   * default to `never`. If you do expect errors of a certain type, specify it
   * explicitly: `.subscribe<"error1" | "error2">()`. To bypass the check, use
   * `unknown` or `any`.
   *
   * `resolve` and `reject` are called with `consumer` object as `this`.
   */
  subscribe<WhitelistedError = never>(
    this: UnboxError<Value> extends WhitelistedError
      ? unknown
      : {
          [`❌ Unhandled boxed errors detected. Either catch them before subscribing, or whitelist them using the type parameter of the .subscribe method.`]: never;
        },
    consumer?: Consumer<Value>,
    // Equivalent to `undefined extends Dep ? [dep?: Dep] : [dep: Dep]`, but
    // with `Dep` only in check positions, so that TS can verify the `in Dep`
    // variance annotation (otherwise a false-positive TS2636 error may pop up
    // depending on check order, e.g. in the editor but not on the command
    // line). `undefined extends null` detects strictNullChecks turned off, in
    // which case `dep` is optional for any `Dep` except `never`. `[Dep] extends
    // [undefined]` is checked before `[Dep] extends [{} | null]` to make sure
    // `dep` is optional when `Dep` is `any`.
    ...args: [Dep] extends [never]
      ? [dep: Dep]
      : undefined extends null
        ? [dep?: Dep]
        : [Dep] extends [undefined]
          ? [dep?: Dep]
          : [Dep] extends [{} | null]
            ? [dep: Dep]
            : [dep?: Dep]
  ): Subscription;
  subscribe(consumer?: Consumer<Value>, dep?: Dep): Subscription {
    const subscription = new Subscription(this.producer, consumer, dep);
    if (this.tracers) {
      subscription.pendingTrace = new PendingTrace(this.tracers, activeSpans);
    }
    subscription.next();
    return subscription;
  }

  /**
   * The LazyPromise equivalent of `promise.then(...)`.
   */
  map<NewValue, ExtraDep = unknown>(
    callback: (
      value: Value extends ErrorBox<any> ? never : Value,
      dep: ExtraDep,
    ) => NewValue,
  ): LazyPromise<
    // eslint-disable-next-line no-use-before-define
    | Unbox<NewValue>
    | (Value extends ErrorBox<infer Error> ? ErrorBox<Error> : never),
    // eslint-disable-next-line no-use-before-define
    Dep & ExtraDep & InferDep<NewValue>
  > {
    return new LazyPromise<any>(new MapProducer(this, callback));
  }

  /**
   * The LazyPromise equivalent of `promise.catch(...)`.
   */
  catch<NewValue, ExtraDep = unknown>(
    callback: (error: unknown, dep: ExtraDep) => NewValue,
  ): LazyPromise<
    // eslint-disable-next-line no-use-before-define
    Value | Unbox<NewValue>,
    // eslint-disable-next-line no-use-before-define
    Dep & ExtraDep & InferDep<NewValue>
  > {
    return new LazyPromise<any>(new CatchProducer(this, callback));
  }

  /**
   * The LazyPromise equivalent of `promise.catch(...)` for boxed errors.
   */
  catchBoxed<NewValue, ExtraDep = unknown>(
    callback: (
      error: Value extends ErrorBox<infer Error> ? Error : never,
      dep: ExtraDep,
    ) => NewValue,
  ): LazyPromise<
    // eslint-disable-next-line no-use-before-define
    (Value extends ErrorBox<any> ? never : Value) | Unbox<NewValue>,
    // eslint-disable-next-line no-use-before-define
    Dep & ExtraDep & InferDep<NewValue>
  > {
    return new LazyPromise<any>(new CatchBoxedProducer(this, callback));
  }

  /**
   * The LazyPromise equivalent of `promise.finally(...)`. The callback
   * is called if the source promise resolves or rejects, but not if it's
   * unsubscribed before settling.
   */
  finally<NewValue, ExtraDep = unknown>(
    callback: (dep: ExtraDep) => NewValue,
  ): LazyPromise<
    // eslint-disable-next-line no-use-before-define
    Value | Extract<Unbox<NewValue>, ErrorBox<any>>,
    // eslint-disable-next-line no-use-before-define
    Dep & ExtraDep & InferDep<NewValue>
  > {
    return new LazyPromise<any>(new FinallyProducer(this, callback));
  }

  /**
   * Satisfies the dependency of the LazyPromise with the value returned by
   * the callback.
   */
  inject<This, ExtraDep = unknown>(
    // Depending on position, occurrence of `Value` or `Dep` in this signature
    // could change measured variance (breaking `InferDep`) or break
    // assignability between LazyPromise instantiations.
    this: This,
    // eslint-disable-next-line no-use-before-define
    callback: (dep: ExtraDep) => InferDep<This>,
  ): LazyPromise<Value, ExtraDep> {
    return new LazyPromise<any>(new InjectProducer(this as any, callback));
  }

  /**
   * Converts a LazyPromise to a Promise. The LazyPromise must have no
   * dependencies and not resolve to boxed errors. You can pass an AbortSignal
   * in the options object.
   */
  toEager<This>(
    // Depending on position, occurrence of `Value` or `Dep` in this signature
    // could change measured variance (breaking `InferDep`) or break
    // assignability between LazyPromise instantiations.
    this: This &
      // eslint-disable-next-line no-use-before-define
      (UnboxError<Unbox<This>> extends never
        ? // eslint-disable-next-line no-use-before-define
          undefined extends InferDep<This>
          ? unknown
          : "❌ You cannot call .toEager on a LazyPromise that has dependencies."
        : "❌ Unhandled boxed errors detected. Catch them before calling the .toEager method."),
    options?: { readonly signal?: AbortSignal },
  ): Promise<Value> {
    return new Promise((resolve, reject) => {
      const signal = options?.signal;
      if (!signal) {
        (this as LazyPromise<Value>).subscribe<any>({ resolve, reject });
        return;
      }
      signal.throwIfAborted();
      const consumerListener = new ToEagerConsumerListener(
        resolve,
        reject,
        signal,
      );
      const subscription = (this as LazyPromise<Value>).subscribe<any>(
        consumerListener,
      );
      if (consumerListener.settled) {
        return;
      }
      if (signal.aborted) {
        subscription.dispose();
        throw signal.reason;
      }
      consumerListener.subscription = subscription;
      signal.addEventListener("abort", consumerListener);
    });
  }

  /**
   * Passes the LazyPromise to a callback and returns the callback result.
   */
  pipe<This, TReturn>(
    // Infers `This` type param which is needed to make things work when you
    // call `pipe` on a union like `LazyPromise<1> | LazyPromise<2>`.
    this: This,
    callback: (value: This) => TReturn,
  ): TReturn {
    return callback(this);
  }

  [Symbol.iterator](): {
    next(
      ...args: ReadonlyArray<any>
    ): IteratorResult<
      LazyPromise<Extract<Value, ErrorBox<any>>, Dep> & Yieldable,
      Exclude<Value, ErrorBox<any>>
    >;
  } {
    return new LazyPromiseIterator(this as any);
  }

  /**
   * Attaches a tracer that observes each subscription to the LazyPromise. To
   * detach it, call `dispose` on the returned object.
   */
  trace<This>(
    // Depending on position, occurrence of `Value` or `Dep` in this signature
    // could change measured variance (breaking `InferDep`) or break
    // assignability between LazyPromise instantiations.
    this: This,
    // eslint-disable-next-line no-use-before-define
    tracer: Tracer<Unbox<This>, InferDep<This>>,
  ): Tracing {
    const lazyPromise = this as unknown as LazyPromise<any, any>;
    const tracing = new Tracing(tracer, lazyPromise, lazyPromise.tracers);
    if (lazyPromise.tracers) {
      lazyPromise.tracers.previous = tracing;
    }
    lazyPromise.tracers = tracing;
    return tracing;
  }

  // Gives `Dep` a contravariant occurrence.
  declare protected inferenceHelper: (dep: Dep) => void;
}

class ResolvingProducer<Value> implements Producer<Value> {
  constructor(public value: Value) {}

  produce(sink: Sink<Value>) {
    sink.resolve(this.value);
  }
}

/**
 * If the argument is a LazyPromise, passes it through, otherwise returns a
 * LazyPromise that synchronously resolves with it.
 */
export const box: {
  <const Arg>(
    arg: Arg,
  ): LazyPromise<Arg extends LazyPromise<infer Value> ? Value : Arg>;
  (): LazyPromise<void>;
} = (arg?: any): any => {
  if (arg instanceof LazyPromise) {
    return arg;
  }
  return new LazyPromise(new ResolvingProducer(arg));
};

class RejectingProducer implements Producer<never> {
  constructor(public error: unknown) {}

  produce(sink: Sink<never>) {
    sink.reject(this.error);
  }
}

/**
 * Returns a LazyPromise which synchronously rejects with the provided error.
 */
export const rejecting = (error?: unknown): LazyPromise<never> =>
  new LazyPromise(new RejectingProducer(error));

class NeverProducer implements Producer<never> {
  constructor() {}

  produce() {}
}

/**
 * A LazyPromise which never resolves or rejects.
 */
export const never: LazyPromise<never> = new LazyPromise(new NeverProducer());

/**
 * The LazyPromise equivalent of Awaited.
 */
export type Unbox<T> = T extends LazyPromise<infer Value, any> ? Value : T;

/**
 * The dependency required to satisfy every LazyPromise in `T`.
 */
export type InferDep<T> =
  Extract<T, LazyPromise<any, never>> extends LazyPromise<any, infer Dep>
    ? Dep
    : unknown;
