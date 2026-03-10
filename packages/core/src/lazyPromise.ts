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

const pipeReducer = (prev: any, fn: (value: any) => any) => fn(prev);

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
 * A Promise-like primitive which is stateless, cancelable, supports typed
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
   * Pipes the lazy promise though the provided functions in the order that they
   * appear in, so `lazyPromise.pipe(a, b)` is `b(a(lazyPromise))`.
   *
   * If you call `.pipe` on say `LazyPromise<1> | LazyPromise<2>`, you'll get an
   * `Expected 0 arguments` TypeScript error. You can prevent it by wrapping the
   * lazy promise in a `box` which will make its type `LazyPromise<1 | 2>`.
   */
  pipe(): LazyPromise<Value>;
  pipe<A>(a: (value: LazyPromise<Value>) => A): A;
  pipe<A, B>(a: (value: LazyPromise<Value>) => A, b: (value: A) => B): B;
  pipe<A, B, C>(
    a: (value: LazyPromise<Value>) => A,
    b: (value: A) => B,
    c: (value: B) => C,
  ): C;
  pipe<A, B, C, D>(
    a: (value: LazyPromise<Value>) => A,
    b: (value: A) => B,
    c: (value: B) => C,
    d: (value: C) => D,
  ): D;
  pipe<A, B, C, D, E>(
    a: (value: LazyPromise<Value>) => A,
    b: (value: A) => B,
    c: (value: B) => C,
    d: (value: C) => D,
    e: (value: D) => E,
  ): E;
  pipe<A, B, C, D, E, F>(
    a: (value: LazyPromise<Value>) => A,
    b: (value: A) => B,
    c: (value: B) => C,
    d: (value: C) => D,
    e: (value: D) => E,
    f: (value: E) => F,
  ): F;
  pipe<A, B, C, D, E, F, G>(
    a: (value: LazyPromise<Value>) => A,
    b: (value: A) => B,
    c: (value: B) => C,
    d: (value: C) => D,
    e: (value: D) => E,
    f: (value: E) => F,
    g: (value: F) => G,
  ): G;
  pipe<A, B, C, D, E, F, G, H>(
    a: (value: LazyPromise<Value>) => A,
    b: (value: A) => B,
    c: (value: B) => C,
    d: (value: C) => D,
    e: (value: D) => E,
    f: (value: E) => F,
    g: (value: F) => G,
    h: (value: G) => H,
  ): H;
  pipe<A, B, C, D, E, F, G, H, I>(
    a: (value: LazyPromise<Value>) => A,
    b: (value: A) => B,
    c: (value: B) => C,
    d: (value: C) => D,
    e: (value: D) => E,
    f: (value: E) => F,
    g: (value: F) => G,
    h: (value: G) => H,
    i: (value: H) => I,
  ): I;
  pipe<A, B, C, D, E, F, G, H, I, J>(
    a: (value: LazyPromise<Value>) => A,
    b: (value: A) => B,
    c: (value: B) => C,
    d: (value: C) => D,
    e: (value: D) => E,
    f: (value: E) => F,
    g: (value: F) => G,
    h: (value: G) => H,
    i: (value: H) => I,
    j: (value: I) => J,
  ): J;
  pipe(...fns: ((value: any) => any)[]): any {
    return fns.reduce(pipeReducer, this);
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
export const rejected = (error?: unknown): LazyPromise<never> =>
  new LazyPromise(new RejectingProducer(error));

class NeverProducer implements Producer<never> {
  constructor() {}

  produce() {}
}

/**
 * A LazyPromise which never resolves or rejects.
 */
export const never: LazyPromise<never> = new LazyPromise(new NeverProducer());

export type Flatten<T> = T extends LazyPromise<infer Value> ? Value : T;
