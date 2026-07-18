import { CatchBoxedErrorProducer } from "./catchBoxedError.js";
import { CatchRejectionProducer } from "./catchRejection.js";
import { FinalizeProducer } from "./finalize.js";
import { MapProducer } from "./map.js";

declare const yieldableSymbol: unique symbol;

export class ErrorBox<const Error> {
  constructor(public readonly error: Error) {}
  declare private brand: any;
}

const throwInMicrotask = (error: unknown) => {
  queueMicrotask(() => {
    throw error;
  });
};

// eslint-disable-next-line no-use-before-define
export type Yieldable = LazyPromise<any> & {
  [yieldableSymbol]: `Did you forget a star (*) after yield?`;
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

/**
 * The object passed to `.subscribe` method of a lazy promise. `resolve` handler
 * is required if the promise can resolve to an ErrorBox.
 */
export type Consumer<Value> = [ErrorBox<any>] extends [Value]
  ? {
      resolve: (value: Value) => void;
      reject?: (error: unknown) => void;
    }
  : {
      resolve?: (value: Value) => void;
      reject?: (error: unknown) => void;
    } | void;

/**
 * The object passed to a lazy promise constructor callback or to the `.produce`
 * method of a Producer.
 */
class Sink<in Value> {
  /** @internal */
  resolvedWithAPromise: boolean = false;

  /** @internal */
  constructor(
    /** @internal */
    // eslint-disable-next-line no-use-before-define
    public subscription: Subscription,
  ) {}

  resolve(
    this: Sink<Value>,
    // eslint-disable-next-line no-use-before-define
    value: Value | LazyPromise<Value>,
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
    subscription.job = undefined;
    if (subscription.consumer?.resolve) {
      try {
        subscription.consumer.resolve(value);
      } catch (error) {
        throwInMicrotask(error);
      }
    } else if (value instanceof ErrorBox) {
      throwInMicrotask(value);
    }
    // For GC purposes.
    subscription.consumer = undefined;
  }

  reject(this: Sink<Value>, error: unknown) {
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

export interface Disposable {
  dispose(): void;
}

class Subscription implements Disposable {
  job: (() => void) | Disposable | void | undefined;
  settled: boolean = false;
  disposed: boolean = false;

  constructor(
    public producer?:
      | ((sink: Sink<any>) => (() => void) | Disposable | void)
      // eslint-disable-next-line no-use-before-define
      | Producer<any>,
    public consumer?: {
      resolve?: (value: any) => void;
      reject?: (error: unknown) => void;
    },
  ) {}

  next() {
    while (true) {
      const sink = new Sink(this);
      try {
        const job =
          typeof this.producer === "function"
            ? (0, this.producer)(sink)
            : this.producer!.produce(sink);
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

/**
 * The class-based equivalent of the lazy promise constructor callback.
 */
export interface Producer<Value> {
  produce: (sink: Sink<Value>) => (() => void) | Disposable | void;
}

/**
 * A Promise-like primitive which is lazy, cancelable, supports typed
 * errors, and emits synchronously instead of in a microtask.
 */
export class LazyPromise<out Value> {
  /** @internal */
  public producer:
    | ((sink: Sink<Value>) => (() => void) | Disposable | void)
    | Producer<Value>;

  constructor(
    producer:
      | ((sink: Sink<Value>) => (() => void) | Disposable | void)
      | Producer<Value>,
  ) {
    this.producer = producer;
  }

  /**
   * Subscribes to the lazy promise. `resolve` handler is required if the
   * promise can resolve to an ErrorBox. `resolve` and `reject` are called with
   * `consumer` object as `this`.
   */
  subscribe(consumer: Consumer<Value>): Disposable {
    const subscription = new Subscription(
      this.producer,
      consumer as Consumer<any>,
    );
    subscription.next();
    return subscription;
  }

  /**
   * The LazyPromise equivalent of `promise.then(...)`.
   */
  map<NewValue>(
    callback: (value: Value extends ErrorBox<any> ? never : Value) => NewValue,
  ): LazyPromise<
    // eslint-disable-next-line no-use-before-define
    | Unbox<NewValue>
    | (Value extends ErrorBox<infer Error> ? ErrorBox<Error> : never)
  > {
    return new LazyPromise<any>(new MapProducer(this, callback));
  }

  /**
   * The LazyPromise equivalent of `promise.catch(...)`.
   */
  catchRejection<NewValue>(
    callback: (error: unknown) => NewValue,
    // eslint-disable-next-line no-use-before-define
  ): LazyPromise<Value | Unbox<NewValue>> {
    return new LazyPromise(new CatchRejectionProducer(this, callback));
  }

  /**
   * The LazyPromise equivalent of `promise.catch(...)` for typed errors.
   */
  catchBoxedError<NewValue>(
    callback: (
      error: Value extends ErrorBox<infer Error> ? Error : never,
    ) => NewValue,
  ): LazyPromise<
    // eslint-disable-next-line no-use-before-define
    (Value extends ErrorBox<any> ? never : Value) | Unbox<NewValue>
  > {
    return new LazyPromise<any>(new CatchBoxedErrorProducer(this, callback));
  }

  /**
   * The LazyPromise equivalent of `promise.finally(...)`. The callback
   * is called if the source promise resolves or rejects, but not if it's
   * unsubscribed before settling.
   */
  finalize<NewValue>(callback: () => NewValue): LazyPromise<
    | Value
    // eslint-disable-next-line no-use-before-define
    | (Unbox<NewValue> extends ErrorBox<infer Error> ? ErrorBox<Error> : never)
  > {
    return new LazyPromise<any>(new FinalizeProducer(this, callback));
  }

  /**
   * Passes the lazy promise to a callback and returns the callback result.
   */
  pipe<Value, TReturn>(
    // Infers `Value` type param which is needed to make things work when you
    // call pipe on a union like `LazyPromise<1> | LazyPromise<2>`.
    this: LazyPromise<Value>,
    callback: (value: LazyPromise<Value>) => TReturn,
  ): TReturn {
    return callback(this);
  }

  [Symbol.iterator](): {
    next(...args: ReadonlyArray<any>): IteratorResult<Yieldable, Value>;
  } {
    return new LazyPromiseIterator(this as any);
  }
}

class ResolvingProducer<Value> implements Producer<Value> {
  constructor(public value: Value) {}

  produce(sink: Sink<Value>) {
    sink.resolve(this.value);
  }
}

/**
 * If the argument is a lazy promise, passes it through, otherwise returns
 * a lazy promise that synchronously resolves with it.
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

export type Unbox<T> = T extends LazyPromise<infer Value> ? Value : T;
