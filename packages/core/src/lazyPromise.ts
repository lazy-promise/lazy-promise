import type { AsyncContextResource } from "./asyncResource.js";
import { AsyncResource } from "./asyncResource.js";
import { CatchProducer } from "./catch.js";
import { CatchBoxedProducer } from "./catchBoxed.js";
import { FinallyProducer } from "./finally.js";
import { InjectProducer } from "./inject.js";
import { log } from "./log.js";
import { MapProducer } from "./map.js";
import { ToEagerConsumerListener } from "./toEager.js";
import type { Frame, Span, Tracer } from "./trace.js";
import {
  activeFrame,
  Chain,
  reverseSpans,
  runFrame,
  runInFrame,
  SpanNode,
  Tracing,
} from "./trace.js";
import { throwInMicrotask } from "./utils.js";

export class ErrorBox<const Error> {
  constructor(public readonly error: Error) {}
  declare private brand: any;
}

export type UnboxError<T> = T extends ErrorBox<infer Error> ? Error : never;

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
  done: boolean = false;

  // A settlement that happens while the producer is running is recorded here
  // and acted upon by `Subscription.runProducer` once the producer returns.
  /** @internal */
  rejected: boolean = false;
  /** @internal */
  pending: any;
  /** @internal */
  frame: Frame | undefined;

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
    const subscription = this.subscription;
    if (this.done || subscription.disposed || subscription.settled) {
      return;
    }
    this.done = true;
    if (subscription.lazyPromise) {
      this.pending = value;
      this.frame = activeFrame;
      return;
    }
    // eslint-disable-next-line no-use-before-define
    if (value instanceof LazyPromise) {
      subscription.runInContext(subscription.resolveWithLazyPromise, value);
      return;
    }
    subscription.runInContext(subscription.resolve, value);
  }

  reject(this: Sink<Value, Dep>, error: unknown) {
    const subscription = this.subscription;
    if (this.done || subscription.disposed || subscription.settled) {
      return;
    }
    this.done = true;
    if (subscription.lazyPromise) {
      this.rejected = true;
      this.pending = error;
      this.frame = activeFrame;
      return;
    }
    subscription.runInContext(subscription.reject, error);
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
  // The spans of all the LazyPromises in the flattening chain, newest first.
  // Those of the current LazyPromise (the last one in the chain) come before
  // `olderSpans`, which is what `spans` was before its tracers were subscribed.
  /** @internal */
  spans: SpanNode | undefined;
  /** @internal */
  olderSpans: SpanNode | undefined;
  // The frame to run the next producer in: the one active when the run was
  // caused, so that nesting is logical rather than physical.
  /** @internal */
  pendingFrame: Frame | undefined;
  // Created only once the producer has returned without settling, because
  // that's when the async context of `subscribe` can get lost.
  /** @internal */
  asyncResource: AsyncContextResource | undefined;

  /** @internal */
  constructor(
    /** @internal */
    // eslint-disable-next-line no-use-before-define
    public lazyPromise?: LazyPromise<any, any>,
    /** @internal */
    public consumer?: {
      resolve?: (value: any) => void;
      reject?: (error: unknown) => void;
    },
    /** @internal */
    public dep?: any,
  ) {
    // Not a field initializer: Vite's SSR transform (used by vitest) snapshots
    // imported bindings referenced in class fields, losing the live binding.
    this.pendingFrame = activeFrame;
  }

  // Methods that run when there is no tracing must not contain closures (even
  // ones that are never created) because that would make V8 allocate a context
  // on every call. That's why the `...Traced` methods are separate.

  /** @internal */
  next() {
    // `lazyPromise` stays set while the producer resolves with LazyPromises,
    // and is cleared when the subscription gets disposed.
    while (this.lazyPromise) {
      const sink = new Sink(this);
      // `this.spans`: even an untraced inner producer of a traced subscription
      // goes through the chain, which restores the context of `subscribe`.
      if (
        this.lazyPromise.tracers ||
        this.spans ||
        this.pendingFrame !== activeFrame
      ) {
        this.runProducerTraced(sink);
      } else {
        this.runProducer(sink);
      }
    }
    if (AsyncResource && !this.settled && !this.disposed) {
      this.asyncResource ??= new AsyncResource("LazyPromise");
    }
  }

  /** @internal */
  runProducerTraced(sink: Sink<any, any>) {
    this.olderSpans = this.spans;
    new Chain(
      this.lazyPromise!.tracers,
      undefined,
      (tracing) => {
        const span = tracing.tracer.subscribe(this.dep, this);
        if (span) {
          this.spans = new SpanNode(span, this.spans);
        }
        return span;
      },
      () => {
        this.runProducer(sink);
      },
    ).run(this.pendingFrame, this.asyncResource);
  }

  /** @internal */
  runProducer(sink: Sink<any, any>) {
    const producer = this.lazyPromise!.producer;
    let job;
    try {
      job =
        typeof producer === "function"
          ? producer(sink, this.dep)
          : producer.produce(sink, this.dep);
    } catch (error) {
      // A no-op if the sink has already been used.
      sink.reject(error);
    }
    this.lazyPromise = undefined;
    // For GC purposes.
    this.pendingFrame = undefined;
    this.job = job;
    if (this.disposed) {
      this.disposeJob();
      return;
    }
    if (!sink.done) {
      return;
    }
    const pending = sink.pending;
    const frame = sink.frame;
    // In case the producer holds on to the sink.
    sink.pending = undefined;
    sink.frame = undefined;
    // eslint-disable-next-line no-use-before-define
    if (!sink.rejected && pending instanceof LazyPromise) {
      this.flatten(pending, frame);
      return;
    }
    if (frame !== activeFrame) {
      this.settleInFrame(frame, sink.rejected, pending);
    } else if (sink.rejected) {
      this.reject(pending);
    } else {
      this.resolve(pending);
    }
  }

  /**
   * Runs the settlement inside the frame that was active when the sink was
   * used, so that nesting is logical rather than physical.
   *
   * @internal
   */
  settleInFrame(frame: Frame | undefined, rejected: boolean, pending: unknown) {
    runInFrame(frame, () => {
      if (rejected) {
        this.reject(pending);
      } else {
        this.resolve(pending);
      }
    });
  }

  /**
   * Prepares the next producer run. Doesn't start it, so that the loop in
   * `next` can be used to avoid increasing stack depth.
   *
   * @internal
   */
  // eslint-disable-next-line no-use-before-define
  flatten(lazyPromise: LazyPromise<any, any>, frame: Frame | undefined) {
    // Set before the teardown runs, which may dispose the subscription and
    // clear it.
    this.lazyPromise = lazyPromise;
    if (this.spans) {
      this.flattenTraced(lazyPromise, frame);
      return;
    }
    this.pendingFrame = frame;
    this.disposeJob();
  }

  /** @internal */
  flattenTraced(
    // eslint-disable-next-line no-use-before-define
    lazyPromise: LazyPromise<any, any>,
    frame: Frame | undefined,
  ) {
    new Chain(
      this.spans,
      this.olderSpans,
      (node) => {
        node.span.flatten?.(lazyPromise);
        return node.span;
      },
      () => {
        // The inner producer runs from the loop in `next`, but in this frame.
        this.pendingFrame = activeFrame;
        this.disposeJob();
      },
    ).run(frame, this.asyncResource);
  }

  /** @internal */
  // eslint-disable-next-line no-use-before-define
  resolveWithLazyPromise(lazyPromise: LazyPromise<any, any>) {
    this.flatten(lazyPromise, activeFrame);
    this.next();
  }

  /** @internal */
  resolve(value: any) {
    this.settled = true;
    // For GC purposes.
    this.dep = undefined;
    if (this.spans) {
      this.resolveTraced(value);
      return;
    }
    // For GC purposes.
    this.asyncResource = undefined;
    this.disposeJob();
    this.consumeValue(value);
  }

  /** @internal */
  resolveTraced(value: any) {
    this.settleSpans(
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
    if (this.spans) {
      this.rejectTraced(error);
      return;
    }
    // For GC purposes.
    this.asyncResource = undefined;
    this.disposeJob();
    this.consumeError(error);
  }

  /** @internal */
  rejectTraced(error: unknown) {
    this.settleSpans(
      (span) => {
        span.reject?.(error);
      },
      () => {
        this.consumeError(error);
      },
    );
  }

  /**
   * Notifies the spans of the current LazyPromise, tears down its job inside
   * their `run`, and only then notifies the spans of the outer LazyPromises,
   * running `consume` inside their `run`: the same order as when the current
   * LazyPromise is subscribed manually by the outer producer.
   *
   * @internal
   */
  settleSpans(notify: (span: Span<any>) => void, consume: () => void) {
    const olderSpans = this.olderSpans;
    const visit = (node: SpanNode) => {
      notify(node.span);
      return node.span;
    };
    new Chain(this.takeSpans(), olderSpans, visit, () => {
      this.disposeJob();
      new Chain(olderSpans, undefined, visit, consume).run(activeFrame);
    }).run(activeFrame, this.asyncResource);
    // For GC purposes.
    this.asyncResource = undefined;
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
    // Ends the loop in `next` if the producer is running.
    this.lazyPromise = undefined;
    // For GC purposes.
    this.pendingFrame = undefined;
    // For GC purposes.
    this.consumer = undefined;
    // For GC purposes.
    this.dep = undefined;
    this.runInContext(this.teardown, undefined);
  }

  /** @internal */
  teardown() {
    if (this.spans) {
      this.disposeTraced();
      return;
    }
    // For GC purposes.
    this.asyncResource = undefined;
    this.disposeJob();
  }

  /** @internal */
  disposeTraced() {
    // Oldest first, so that the teardown is innermost.
    new Chain(
      reverseSpans(this.takeSpans()),
      undefined,
      (node) => {
        node.span.unsubscribe?.();
        return node.span;
      },
      () => {
        this.disposeJob();
      },
    ).run(activeFrame, this.asyncResource);
    // For GC purposes.
    this.asyncResource = undefined;
  }

  /** @internal */
  takeSpans() {
    const spans = this.spans;
    this.spans = undefined;
    this.olderSpans = undefined;
    return spans;
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

  /**
   * Calls the method in the async context of `subscribe`. Not when traced:
   * the spans are notified in the context of whatever caused the call, and
   * the chain restores the context of `subscribe` for the `run` calls and
   * the work.
   *
   * @internal
   */
  runInContext<Arg>(method: (this: this, arg: Arg) => void, arg: Arg) {
    if (!this.asyncResource || this.spans) {
      method.call(this, arg);
    } else if (activeFrame) {
      this.runInContextAndFrame(method, arg);
    } else {
      this.asyncResource.runInAsyncScope(method, this, arg);
    }
  }

  /**
   * Re-enters the active frame after restoring the context, so that the
   * context set up by its `run` wins over the restored one.
   *
   * @internal
   */
  runInContextAndFrame<Arg>(method: (this: this, arg: Arg) => void, arg: Arg) {
    const frame = activeFrame!;
    this.asyncResource!.runInAsyncScope(() => {
      runFrame(frame, () => {
        method.call(this, arg);
      });
    }, undefined);
  }
}

export type { Subscription };

export interface Producer<Value, Dep = unknown> {
  produce: (sink: Sink<Value, Dep>, dep: Dep) => (() => void) | Job | void;
}

/**
 * A Promise-like primitive which is lazy, cancelable, and does not defer
 * notifications to microtasks.
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
    const subscription = new Subscription(this, consumer, dep);
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
    return new Tracing(tracer, this as unknown as LazyPromise<any, any>);
  }

  /**
   * Returns the LazyPromise itself but adds logging of everything that
   * happens to it.
   *
   * While running callbacks, patches `console.log` so that the arguments are
   * prefixed with dots indicating causality, so
   *
   * ```
   * box(42)
   *   .log("a")
   *   .map(() => {
   *     console.log("mapping");
   *   })
   *   .subscribe();
   * ```
   *
   * will log
   *
   * ```
   * [a] [1] [subscribe] undefined
   * · [a] [1] [resolve] 42
   * · · mapping
   * ```
   *
   * Dots reset whenever an async boundary is crossed. The number in the
   * second pair of brackets tells apart entries that share a label. The value
   * logged after `[subscribe]` is the dependency.
   */
  log(label?: string | number): this {
    log(this, label);
    return this;
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
