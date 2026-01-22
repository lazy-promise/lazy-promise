const resolvedSymbol = Symbol("resolved");
const rejectedSymbol = Symbol("rejected");
const failedSymbol = Symbol("failed");
declare const yieldableSymbol: unique symbol;
declare const stabilizerSymbol: unique symbol;

interface Subscriber<Value, Error> {
  handleValue?: (value: Value) => void;
  handleRejection?: (error: Error) => void;
  handleFailure?: (error: unknown) => void;
}

const getActionStr = (
  action: typeof resolvedSymbol | typeof rejectedSymbol | typeof failedSymbol,
) =>
  action === resolvedSymbol
    ? `resolve`
    : action === rejectedSymbol
      ? `reject`
      : (action satisfies typeof failedSymbol, `fail`);

const alreadySettledErrorMessage = (
  action: typeof resolvedSymbol | typeof rejectedSymbol | typeof failedSymbol,
  status: typeof resolvedSymbol | typeof rejectedSymbol | typeof failedSymbol,
) =>
  `You cannot ${getActionStr(action)} ${action === status ? `an already` : `a`} ${status === resolvedSymbol ? `resolved` : status === rejectedSymbol ? `rejected` : (status satisfies typeof failedSymbol, `failed`)} lazy promise.`;

const noSubscribersErrorMessage = (
  action: typeof resolvedSymbol | typeof rejectedSymbol | typeof failedSymbol,
) =>
  `You cannot ${getActionStr(action)} a lazy promise that no longer has any subscribers. This error indicates that the lazy promise has not been fully torn down. Make sure that the callback you're passing to the LazyPromise constructor returns a working teardown function.`;

const cannotSubscribeMessage = `You cannot subscribe to a lazy promise while its teardown function is running.`;

// We throw failure errors as they are, but when there is an unhandled
// rejection, we wrap it before throwing because (1) failure to handle a
// rejection is itself an error and (2) it's normal for rejection errors to be
// something other than Error instances, and so to not have a stack trace.
const wrapRejectionError = (error: unknown) =>
  new Error(
    `Unhandled rejection. The original error has been stored as the .cause property.`,
    { cause: error },
  );

/**
 * A LazyPromise returns this no-op function as the disposal handle iff it
 * settles synchronously, so you can do
 *
 * ```
 * const unsubscribe = lazyPromise.subscribe(...);
 * const lazyPromiseIsSettled = (unsubscribe === noopUnsubscribe);
 * ```
 */
export const noopUnsubscribe = () => {};

const throwInMicrotask = (error: unknown) => {
  queueMicrotask(() => {
    throw error;
  });
};

const pipeReducer = (prev: any, fn: (value: any) => any) => fn(prev);

export type Yieldable<T> = T & {
  [yieldableSymbol]: `Did you forget a star (*) after yield?`;
};

class LazyPromiseIterator<T, TReturn> {
  private done = false;

  constructor(private yieldable: T) {}

  next(value: TReturn): IteratorResult<T, TReturn> {
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
}

/**
 * A Promise-like primitive which is lazy/cancelable, has typed errors, and
 * emits synchronously instead of on the microtask queue.
 */
export class LazyPromise<Value, Error = never> {
  private status:
    | undefined
    | typeof resolvedSymbol
    | typeof rejectedSymbol
    | typeof failedSymbol;
  private result: unknown;
  private subscribers: Subscriber<Value, Error>[] | undefined;
  private dispose: (() => void) | undefined;

  constructor(
    private produce: (
      resolve: (value: Value) => void,
      reject: (error: Error) => void,
      fail: (error: unknown) => void,
    ) => (() => void) | void,
  ) {}

  private resolve(value: Value) {
    if (this.status) {
      throw new Error(alreadySettledErrorMessage(resolvedSymbol, this.status));
    }
    if (!this.subscribers) {
      throw new Error(noSubscribersErrorMessage(resolvedSymbol));
    }
    this.result = value;
    this.status = resolvedSymbol;
    // For GC purposes.
    (this.produce as unknown) = undefined;
    // For GC purposes.
    this.dispose = undefined;
    for (let i = 0; i < this.subscribers.length; i++) {
      const handleValue = this.subscribers[i]!.handleValue;
      if (handleValue) {
        try {
          handleValue(this.result as Value);
        } catch (error) {
          throwInMicrotask(error);
        }
        // For GC purposes: unsubscribe handle keeps a reference to the
        // subscriber.
        delete this.subscribers[i]!.handleValue;
      }
      // For GC purposes: unsubscribe handle keeps a reference to the
      // subscriber.
      delete this.subscribers[i]!.handleRejection;
      // For GC purposes: unsubscribe handle keeps a reference to the
      // subscriber.
      delete this.subscribers[i]!.handleFailure;
    }
    this.subscribers = undefined;
  }

  private reject(error: Error) {
    if (this.status) {
      throw new Error(alreadySettledErrorMessage(rejectedSymbol, this.status));
    }
    if (!this.subscribers) {
      throw new Error(noSubscribersErrorMessage(rejectedSymbol));
    }
    this.result = error;
    this.status = rejectedSymbol;
    // For GC purposes.
    (this.produce as unknown) = undefined;
    // For GC purposes.
    this.dispose = undefined;
    let unhandledRejection = false;
    for (let i = 0; i < this.subscribers.length; i++) {
      const handleRejection = this.subscribers[i]!.handleRejection;
      if (handleRejection) {
        try {
          handleRejection(this.result as Error);
        } catch (error) {
          throwInMicrotask(error);
        }
        // For GC purposes: unsubscribe handle keeps a reference to the
        // subscriber.
        delete this.subscribers[i]!.handleRejection;
      } else {
        unhandledRejection = true;
      }
      // For GC purposes: unsubscribe handle keeps a reference to the
      // subscriber.
      delete this.subscribers[i]!.handleValue;
      // For GC purposes: unsubscribe handle keeps a reference to the
      // subscriber.
      delete this.subscribers[i]!.handleFailure;
    }
    if (unhandledRejection) {
      throwInMicrotask(wrapRejectionError(this.result));
    }
    this.subscribers = undefined;
  }

  private fail(error: unknown) {
    if (this.status) {
      throw new Error(alreadySettledErrorMessage(failedSymbol, this.status));
    }
    if (!this.subscribers) {
      throw new Error(noSubscribersErrorMessage(failedSymbol));
    }
    this.result = error;
    this.status = failedSymbol;
    // For GC purposes.
    (this.produce as unknown) = undefined;
    // For GC purposes.
    this.dispose = undefined;
    let unhandledFailure = false;
    for (let i = 0; i < this.subscribers.length; i++) {
      const handleFailure = this.subscribers[i]!.handleFailure;
      if (handleFailure) {
        try {
          handleFailure(error);
        } catch (error) {
          throwInMicrotask(error);
        }
        // For GC purposes: unsubscribe handle keeps a reference to the
        // subscriber.
        delete this.subscribers[i]!.handleFailure;
      } else {
        unhandledFailure = true;
      }
      // For GC purposes: unsubscribe handle keeps a reference to the
      // subscriber.
      delete this.subscribers[i]!.handleValue;
      // For GC purposes: unsubscribe handle keeps a reference to the
      // subscriber.
      delete this.subscribers[i]!.handleRejection;
    }
    if (unhandledFailure) {
      throwInMicrotask(this.result);
    }
    this.subscribers = undefined;
  }

  private unsubscribe(subscriber: Subscriber<Value, Error>) {
    if (this.status || !this.subscribers) {
      return;
    } else if (this.subscribers.length === 1) {
      if (this.subscribers[0] !== subscriber) {
        return;
      }
      this.subscribers = undefined;
      if (this.dispose) {
        try {
          this.dispose();
        } catch (error) {
          this.status = failedSymbol;
          this.result = error;
          // For GC purposes.
          (this.produce as unknown) = undefined;
          throwInMicrotask(error);
        }
        this.dispose = undefined;
      }
    } else {
      const swap = this.subscribers.indexOf(subscriber);
      if (swap === -1) {
        return;
      }
      this.subscribers[swap] = this.subscribers[this.subscribers.length - 1]!;
      this.subscribers.pop();
    }
    // For GC purposes.
    delete subscriber.handleValue;
    // For GC purposes.
    delete subscriber.handleRejection;
    // For GC purposes.
    delete subscriber.handleFailure;
  }

  /**
   * Subscribes to the lazy promise. Rejection handler must be provided if the
   * error type is other than `never`.
   */
  subscribe(
    handleValue: ((value: Value) => void) | void,
    handleRejection: [Error] extends [never]
      ? ((error: Error) => void) | void
      : (error: Error) => void,
    handleFailure: ((error: unknown) => void) | void,
  ) {
    if (this.status === resolvedSymbol) {
      if (handleValue) {
        try {
          handleValue(this.result as Value);
        } catch (error) {
          throwInMicrotask(error);
        }
      }
      return noopUnsubscribe;
    }
    if (this.status === rejectedSymbol) {
      if (handleRejection) {
        try {
          handleRejection(this.result as Error);
        } catch (error) {
          throwInMicrotask(error);
        }
      } else {
        throwInMicrotask(wrapRejectionError(this.result));
      }
      return noopUnsubscribe;
    }
    if (this.status === failedSymbol) {
      if (handleFailure) {
        try {
          handleFailure(this.result);
        } catch (error) {
          throwInMicrotask(error);
        }
      } else {
        throwInMicrotask(this.result);
      }
      return noopUnsubscribe;
    }
    if (!this.subscribers && this.dispose) {
      throw new Error(cannotSubscribeMessage);
    }
    const subscriber: Subscriber<Value, Error> = {};
    if (handleValue) {
      subscriber.handleValue = handleValue;
    }
    if (handleRejection) {
      subscriber.handleRejection = handleRejection;
    }
    if (handleFailure) {
      subscriber.handleFailure = handleFailure;
    }
    if (this.subscribers) {
      this.subscribers.push(subscriber);
    } else {
      this.subscribers = [subscriber];
      try {
        const retVal = this.produce(
          (value) => {
            this.resolve(value);
          },
          (error) => {
            this.reject(error);
          },
          (error) => {
            this.fail(error);
          },
        ) as (() => void) | undefined;
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (this.subscribers) {
          this.dispose = retVal;
        }
      } catch (error) {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (!this.status) {
          this.fail(error);
        } else {
          throwInMicrotask(error);
        }
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (this.status) {
      return noopUnsubscribe;
    }
    return () => {
      this.unsubscribe(subscriber);
    };
  }

  /**
   * Pipes the lazy promise though the provided functions in the order that they
   * appear in, so `lazyPromise.pipe(a, b)` is `b(a(lazyPromise))`.
   *
   * If you call `.pipe` on say `LazyPromise<1, never> | LazyPromise<2, never>`,
   * you'll get an `Expected 0 arguments` TypeScript error. You can prevent it
   * by wrapping the lazy promise in a `box` which will make its type
   * `LazyPromise<1 | 2, never>`.
   */
  pipe(): LazyPromise<Value, Error>;
  pipe<A>(a: (value: LazyPromise<Value, Error>) => A): A;
  pipe<A, B>(a: (value: LazyPromise<Value, Error>) => A, b: (value: A) => B): B;
  pipe<A, B, C>(
    a: (value: LazyPromise<Value, Error>) => A,
    b: (value: A) => B,
    c: (value: B) => C,
  ): C;
  pipe<A, B, C, D>(
    a: (value: LazyPromise<Value, Error>) => A,
    b: (value: A) => B,
    c: (value: B) => C,
    d: (value: C) => D,
  ): D;
  pipe<A, B, C, D, E>(
    a: (value: LazyPromise<Value, Error>) => A,
    b: (value: A) => B,
    c: (value: B) => C,
    d: (value: C) => D,
    e: (value: D) => E,
  ): E;
  pipe<A, B, C, D, E, F>(
    a: (value: LazyPromise<Value, Error>) => A,
    b: (value: A) => B,
    c: (value: B) => C,
    d: (value: C) => D,
    e: (value: D) => E,
    f: (value: E) => F,
  ): F;
  pipe<A, B, C, D, E, F, G>(
    a: (value: LazyPromise<Value, Error>) => A,
    b: (value: A) => B,
    c: (value: B) => C,
    d: (value: C) => D,
    e: (value: D) => E,
    f: (value: E) => F,
    g: (value: F) => G,
  ): G;
  pipe<A, B, C, D, E, F, G, H>(
    a: (value: LazyPromise<Value, Error>) => A,
    b: (value: A) => B,
    c: (value: B) => C,
    d: (value: C) => D,
    e: (value: D) => E,
    f: (value: E) => F,
    g: (value: F) => G,
    h: (value: G) => H,
  ): H;
  pipe<A, B, C, D, E, F, G, H, I>(
    a: (value: LazyPromise<Value, Error>) => A,
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
    a: (value: LazyPromise<Value, Error>) => A,
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
    next(
      ...args: ReadonlyArray<any>
    ): IteratorResult<Yieldable<LazyPromise<Value, Error>>, Value>;
  } {
    return new LazyPromiseIterator(this as Yieldable<typeof this>);
  }

  /**
   * Fixes TS union inference. TS was confused by `[Error] extends [never]`
   * check in the `subscribe` signature, and as a result the type of a generator
   * function like
   *
   * ```
   * function* () {
   *   if (...) {
   *     return rejected(1);
   *   }
   *   return box(2);
   * }
   * ```
   *
   * ignored the second return statement.
   */
  declare readonly [stabilizerSymbol]: Error;
}

interface SettledLazyPromise {
  result: unknown;
  subscribe: LazyPromise<any, any>["subscribe"];
}

function resolvedSubscribe(
  this: SettledLazyPromise,
  resolve: ((value: any) => void) | void,
) {
  try {
    resolve?.(this.result);
  } catch (error) {
    throwInMicrotask(error);
  }
  return noopUnsubscribe;
}

/**
 * If the argument is a lazy promise, passes it through, otherwise wraps it in a
 * resolved lazy promise.
 */
export const box: {
  <const Arg>(
    arg: Arg,
  ): LazyPromise<
    Arg extends LazyPromise<infer Value, any> ? Value : Arg,
    Arg extends LazyPromise<any, infer Error> ? Error : never
  >;
  (): LazyPromise<void, never>;
} = (arg?: any): any => {
  if (arg instanceof LazyPromise) {
    return arg;
  }
  const instance = Object.create(LazyPromise.prototype) as SettledLazyPromise;
  instance.result = arg;
  instance.subscribe = resolvedSubscribe;
  return instance;
};

function rejectedSubscribe(
  this: SettledLazyPromise,
  resolve: ((value: never) => void) | void,
  reject: ((error: any) => void) | void,
) {
  if (reject) {
    try {
      reject(this.result);
    } catch (error) {
      throwInMicrotask(error);
    }
  } else {
    throwInMicrotask(this.result);
  }
  return noopUnsubscribe;
}

/**
 * Returns a LazyPromise which is already rejected.
 */
export const rejected: {
  <const Error>(error: Error): LazyPromise<never, Error>;
  (): LazyPromise<never, void>;
} = (error?: any): any => {
  const instance = Object.create(LazyPromise.prototype) as SettledLazyPromise;
  instance.result = error;
  instance.subscribe = rejectedSubscribe;
  return instance;
};

function failedSubscribe(
  this: SettledLazyPromise,
  resolve: ((value: never) => void) | void,
  reject: ((error: never) => void) | void,
  fail: ((error: unknown) => void) | void,
) {
  if (fail) {
    try {
      fail(this.result);
    } catch (error) {
      throwInMicrotask(error);
    }
  } else {
    throwInMicrotask(this.result);
  }
  return noopUnsubscribe;
}

/**
 * Returns a LazyPromise which is already failed.
 */
export const failed = (error?: unknown): LazyPromise<never, never> => {
  const instance = Object.create(LazyPromise.prototype) as SettledLazyPromise;
  instance.result = error;
  instance.subscribe = failedSubscribe;
  return instance as any;
};

// This is a tricky point: whether `never` should return `noopUnsubscribe`. At
// first glance, you'd say yes because the client logic seems to be typically
// the same as long as the promise is guaranteed to never fire in the future,
// doesn't matter if it's a lazy promise that settles synchronously or it's
// `never`. In practice though, this would mean that to get performance
// benefits, `map` would have to check if its source observable is `never` and
// in that case return `never`, `all` would have to check if all of its sources
// are `never` promises, and most importantly, client-built operators would also
// have to implement this type of short-circuiting logic. Also, when `never`
// does not return `noopUnsubscribe`, this gives `noopUnsubscribe` an easily
// defined meaning of "the promise has settled synchronously".
const neverUnsubscribe = () => {};

const neverSubscribe = () => neverUnsubscribe;

/**
 * A LazyPromise which never resolves, rejects or fails.
 */
export const never: LazyPromise<never, never> = Object.create(
  LazyPromise.prototype,
);
never.subscribe = neverSubscribe;

export type LazyPromiseValue<T> =
  T extends LazyPromise<infer Value, unknown> ? Value : never;

export type LazyPromiseError<T> =
  T extends LazyPromise<unknown, infer Error> ? Error : never;
