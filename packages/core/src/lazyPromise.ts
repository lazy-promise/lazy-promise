import { CatchProducer } from "./catch.js";
import { CatchBoxedProducer } from "./catchBoxed.js";
import { FinallyProducer } from "./finally.js";
import { InjectProducer } from "./inject.js";
import { MapProducer } from "./map.js";
import { ToEagerConsumerListener } from "./toEager.js";

export class ErrorBox<const Error> {
  constructor(public readonly error: Error) {}
  declare private brand: any;
}

export type UnboxError<T> = T extends ErrorBox<infer Error> ? Error : never;

const throwInMicrotask = (error: unknown) => {
  queueMicrotask(() => {
    throw error;
  });
};

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
    subscription.settled = true;
    // For GC purposes.
    subscription.dep = undefined;
    // For GC purposes.
    subscription.job = undefined;
    if (subscription.consumer?.resolve) {
      try {
        subscription.consumer.resolve(value);
      } catch (error) {
        throwInMicrotask(error);
      }
    }
    // For GC purposes.
    subscription.consumer = undefined;
  }

  reject(this: Sink<Value, Dep>, error: unknown) {
    if (this.resolvedWithAPromise) {
      return;
    }
    const subscription = this.subscription;
    if (subscription.disposed || subscription.settled) {
      return;
    }
    subscription.settled = true;
    // For GC purposes.
    subscription.job = undefined;
    // For GC purposes.
    subscription.dep = undefined;
    if (subscription.consumer?.reject) {
      try {
        subscription.consumer.reject(error);
      } catch (error) {
        throwInMicrotask(error);
      }
    } else {
      throwInMicrotask(error);
    }
    // For GC purposes.
    subscription.consumer = undefined;
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

  /** @internal */
  next() {
    while (true) {
      const sink = new Sink(this);
      try {
        const job =
          typeof this.producer === "function"
            ? (0, this.producer)(sink, this.dep)
            : this.producer!.produce(sink, this.dep);
        if (sink.resolvedWithAPromise) {
          continue;
        }
        this.producer = undefined;
        if (this.settled) {
          return;
        }
        if (this.disposed) {
          if (job) {
            try {
              typeof job === "function" ? job() : job.dispose();
            } catch (error) {
              throwInMicrotask(error);
            }
          }
          return;
        }
        this.job = job;
      } catch (error) {
        if (sink.resolvedWithAPromise) {
          continue;
        }
        // For GC purposes.
        this.producer = undefined;
        if (this.disposed || this.settled) {
          return;
        }
        this.settled = true;
        // For GC purposes.
        this.dep = undefined;
        if (this.consumer?.reject) {
          try {
            this.consumer.reject(error);
          } catch (error) {
            throwInMicrotask(error);
          }
        } else {
          throwInMicrotask(error);
        }
        // For GC purposes.
        this.consumer = undefined;
      }
      return;
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
    if (this.job) {
      try {
        typeof this.job === "function" ? (0, this.job)() : this.job.dispose();
      } catch (error) {
        throwInMicrotask(error);
      }
      // For GC purposes.
      this.job = undefined;
    }
  }
}

export type { Subscription };

export interface Producer<Value, Dep = unknown> {
  produce: (sink: Sink<Value, Dep>, dep: Dep) => (() => void) | Job | void;
}

/**
 * A Promise-like primitive which is lazy, cancelable, emits synchronously
 * instead of in a microtask, and supports typed errors and dependency
 * injection.
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
    // We avoid occurrence of `Dep` in a method signature since this would
    // affect its measured variance and break `InferDep`.
    this: This,
    // eslint-disable-next-line no-use-before-define
    callback: (dep: ExtraDep) => InferDep<This>,
  ): LazyPromise<Value, ExtraDep> {
    return new LazyPromise<any>(new InjectProducer(this as any, callback));
  }

  /**
   * Converts a LazyPromise to a Promise. You can pass an AbortSignal in the
   * options object.
   *
   * The type parameter `WhitelistedError` is used to constrain the type of
   * boxed errors that the promise is allowed to resolve to. If you do not
   * expect  _any_ boxed errors, just omit the type parameter so it would
   * default to `never`. If you do expect errors of a certain type, specify it
   * explicitly: `.toEager<"error1" | "error2">()`. To bypass the check, use
   * `unknown` or `any`.
   */
  toEager<WhitelistedError = never>(
    this: UnboxError<Value> extends WhitelistedError
      ? unknown
      : {
          [`❌ Unhandled boxed errors detected. Either catch them before calling .toEager, or whitelist them using that method's type parameter.`]: never;
        },
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
