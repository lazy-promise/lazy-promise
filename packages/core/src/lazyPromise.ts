import { CatchRejectionProducer } from "./catchRejection";
import { CatchTypedErrorProducer } from "./catchTypedError";
import { FinalizeProducer } from "./finalize";
import { MapProducer } from "./map";

declare const yieldableSymbol: unique symbol;

export class TypedError<const Error> {
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
 * is required if the promise can resolve to a TypedError.
 */
export type Subscriber<Value> = [TypedError<any>] extends [Value]
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
class InnerSubscriber<in Value> {
  /** @internal */
  resolvedWithAPromise: boolean = false;

  /** @internal */
  constructor(
    /** @internal */
    // eslint-disable-next-line no-use-before-define
    public subscription: Subscription,
  ) {}

  resolve(
    this: InnerSubscriber<Value>,
    // eslint-disable-next-line no-use-before-define
    value: Value | LazyPromise<Value>,
  ) {
    if (this.resolvedWithAPromise) {
      return;
    }
    const subscription = this.subscription;
    if (subscription.unsubscribed || subscription.settled) {
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
      subscription.innerSubscription = undefined;
      subscription.next();
      return;
    }
    subscription.settled = true;
    // For GC purposes.
    subscription.innerSubscription = undefined;
    if (subscription.subscriber?.resolve) {
      try {
        subscription.subscriber.resolve(value);
      } catch (error) {
        throwInMicrotask(error);
      }
    } else if (value instanceof TypedError) {
      throwInMicrotask(value);
    }
    // For GC purposes.
    subscription.subscriber = undefined;
  }

  reject(this: InnerSubscriber<Value>, error: unknown) {
    if (this.resolvedWithAPromise) {
      return;
    }
    const subscription = this.subscription;
    if (subscription.unsubscribed || subscription.settled) {
      return;
    }
    subscription.settled = true;
    // For GC purposes.
    subscription.innerSubscription = undefined;
    if (subscription.subscriber?.reject) {
      try {
        subscription.subscriber.reject(error);
      } catch (error) {
        throwInMicrotask(error);
      }
    } else {
      throwInMicrotask(error);
    }
    // For GC purposes.
    subscription.subscriber = undefined;
  }
}

export type { InnerSubscriber };

/**
 * The object returned by `.subscribe` method of a lazy promise.
 */
class Subscription {
  /** @internal */
  innerSubscription:
    | (() => void)
    // eslint-disable-next-line no-use-before-define
    | InnerSubscription
    | void
    | undefined;
  /** @internal */
  settled: boolean = false;
  /** @internal */
  unsubscribed: boolean = false;

  /** @internal */
  constructor(
    /** @internal */
    public producer?:
      | ((
          subscriber: InnerSubscriber<any>,
        ) => (() => void) | Subscription | void)
      // eslint-disable-next-line no-use-before-define
      | Producer<any>,
    /** @internal */
    public subscriber?: {
      resolve?: (value: any) => void;
      reject?: (error: unknown) => void;
    },
  ) {}

  /** @internal */
  next() {
    while (true) {
      const innerSubscriber = new InnerSubscriber(this);
      try {
        const innerSubscription =
          typeof this.producer === "function"
            ? (0, this.producer)(innerSubscriber)
            : this.producer!.produce(innerSubscriber);
        if (innerSubscriber.resolvedWithAPromise) {
          continue;
        }
        this.producer = undefined;
        if (this.settled) {
          return;
        }
        if (this.unsubscribed) {
          if (innerSubscription) {
            try {
              typeof innerSubscription === "function"
                ? innerSubscription()
                : innerSubscription.unsubscribe();
            } catch (error) {
              throwInMicrotask(error);
            }
          }
          return;
        }
        this.innerSubscription = innerSubscription;
      } catch (error) {
        if (innerSubscriber.resolvedWithAPromise) {
          continue;
        }
        // For GC purposes.
        this.producer = undefined;
        if (this.unsubscribed || this.settled) {
          return;
        }
        this.settled = true;
        if (this.subscriber?.reject) {
          try {
            this.subscriber.reject(error);
          } catch (error) {
            throwInMicrotask(error);
          }
        } else {
          throwInMicrotask(error);
        }
        // For GC purposes.
        this.subscriber = undefined;
      }
      return;
    }
  }

  unsubscribe(this: Subscription) {
    if (this.settled || this.unsubscribed) {
      return;
    }
    this.unsubscribed = true;
    // For GC purposes.
    this.subscriber = undefined;
    if (this.innerSubscription) {
      try {
        typeof this.innerSubscription === "function"
          ? (0, this.innerSubscription)()
          : this.innerSubscription.unsubscribe();
      } catch (error) {
        throwInMicrotask(error);
      }
      // For GC purposes.
      this.innerSubscription = undefined;
    }
  }
}

export type { Subscription };

/**
 * The class-based equivalent of the teardown function returned by a lazy
 * promise constructor callback.
 */
export interface InnerSubscription {
  unsubscribe: () => void;
}

/**
 * The class-based equivalent of the lazy promise constructor callback.
 */
export interface Producer<Value> {
  produce: (
    subscriber: InnerSubscriber<Value>,
  ) => (() => void) | InnerSubscription | void;
}

/**
 * A Promise-like primitive which is lazy, cancelable, supports typed
 * errors, and emits synchronously instead of in a microtask.
 */
export class LazyPromise<out Value> {
  /** @internal */
  public producer:
    | ((
        subscriber: InnerSubscriber<Value>,
      ) => (() => void) | Subscription | void)
    | Producer<Value>;

  constructor(
    producer:
      | ((
          subscriber: InnerSubscriber<Value>,
        ) => (() => void) | Subscription | void)
      | Producer<Value>,
  ) {
    this.producer = producer;
  }

  /**
   * Subscribes to the lazy promise. `resolve` handler is required if the
   * promise can resolve to a TypedError. `resolve` and `reject` are called with
   * `subscriber` object as `this`.
   */
  subscribe(subscriber: Subscriber<Value>): Subscription {
    const subscription = new Subscription(
      this.producer,
      subscriber as Subscriber<any>,
    );
    subscription.next();
    return subscription;
  }

  /**
   * The LazyPromise equivalent of `promise.then(...)`.
   */
  map<NewValue>(
    callback: (
      value: Value extends TypedError<any> ? never : Value,
    ) => NewValue,
  ): LazyPromise<
    // eslint-disable-next-line no-use-before-define
    | Unbox<NewValue>
    | (Value extends TypedError<infer Error> ? TypedError<Error> : never)
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
  catchTypedError<NewValue>(
    callback: (
      error: Value extends TypedError<infer Error> ? Error : never,
    ) => NewValue,
  ): LazyPromise<
    // eslint-disable-next-line no-use-before-define
    (Value extends TypedError<any> ? never : Value) | Unbox<NewValue>
  > {
    return new LazyPromise<any>(new CatchTypedErrorProducer(this, callback));
  }

  /**
   * The LazyPromise equivalent of `promise.finally(...)`. The callback
   * is called if the source promise resolves or rejects, but not if it's
   * unsubscribed before settling.
   */
  finalize<NewValue>(callback: () => NewValue): LazyPromise<
    | Value
    // eslint-disable-next-line no-use-before-define
    | (Unbox<NewValue> extends TypedError<infer Error>
        ? TypedError<Error>
        : never)
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

  produce(subscriber: InnerSubscriber<Value>) {
    subscriber.resolve(this.value);
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

  produce(subscriber: InnerSubscriber<never>) {
    subscriber.reject(this.error);
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
