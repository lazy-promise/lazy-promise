const resolvedSymbol = Symbol("resolved");
const rejectedSymbol = Symbol("rejected");
const failedSymbol = Symbol("failed");
const neverSymbol = Symbol("never");
declare const yieldableSymbol: unique symbol;
declare const stabilizerSymbol: unique symbol;

interface Subscriber<Value, Error> {
  handleValue?: (value: Value) => void;
  handleRejection?: (error: Error) => void;
  handleFailure?: (error: unknown) => void;
  next?: Subscriber<Value, Error>;
  previous?: Subscriber<Value, Error>;
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

const disposedErrorMessage = (
  action: typeof resolvedSymbol | typeof rejectedSymbol | typeof failedSymbol,
) => `You cannot ${getActionStr(action)} a lazy promise which was torn down.`;

const noDisposeErrorMessage = (
  action: typeof resolvedSymbol | typeof rejectedSymbol | typeof failedSymbol,
) =>
  `You cannot asynchronously ${getActionStr(action)} a lazy promise which does not have a teardown function other than noopUnsubscribe.`;

const cannotSubscribeInProduceMessage = `You cannot subscribe to a lazy promise from its constructor callback.`;

const cannotSubscribeInDisposeMessage = `You cannot subscribe to a lazy promise from its teardown function.`;

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

class LazyPromiseIterator<TYield> implements Iterator<TYield> {
  private done = false;

  constructor(private yieldable: TYield) {}

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

  return(value: any): IteratorResult<TYield> {
    return {
      value,
      done: true,
    };
  }

  throw(error: unknown): IteratorResult<TYield> {
    throw error;
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
    | typeof failedSymbol
    | typeof neverSymbol;
  private result: unknown;
  // A linked list.
  private subscribers: Subscriber<Value, Error> | undefined;
  private dispose: (() => void) | undefined;

  constructor(
    private produce: (
      resolve: (value: Value) => void,
      reject: (error: Error) => void,
      fail: (error: unknown) => void,
    ) => (() => void) | void,
  ) {}

  private resolve(value: Value) {
    if (this.status === neverSymbol) {
      throw new Error(noDisposeErrorMessage(resolvedSymbol));
    }
    if (this.status) {
      throw new Error(alreadySettledErrorMessage(resolvedSymbol, this.status));
    }
    if (!this.subscribers) {
      throw new Error(disposedErrorMessage(resolvedSymbol));
    }
    this.result = value;
    this.status = resolvedSymbol;
    // For GC purposes.
    (this.produce as unknown) = undefined;
    // For GC purposes.
    this.dispose = undefined;
    do {
      const handleValue = this.subscribers.handleValue;
      if (handleValue) {
        try {
          handleValue(this.result as Value);
        } catch (error) {
          throwInMicrotask(error);
        }
        // For GC purposes: unsubscribe handle keeps a reference to the
        // subscriber.
        delete this.subscribers.handleValue;
      }
      // For GC purposes: unsubscribe handle keeps a reference to the
      // subscriber.
      delete this.subscribers.handleRejection;
      // For GC purposes: unsubscribe handle keeps a reference to the
      // subscriber.
      delete this.subscribers.handleFailure;
      this.subscribers = this.subscribers.next;
    } while (this.subscribers);
  }

  private reject(error: Error) {
    if (this.status === neverSymbol) {
      throw new Error(noDisposeErrorMessage(rejectedSymbol));
    }
    if (this.status) {
      throw new Error(alreadySettledErrorMessage(rejectedSymbol, this.status));
    }
    if (!this.subscribers) {
      throw new Error(disposedErrorMessage(rejectedSymbol));
    }
    this.result = error;
    this.status = rejectedSymbol;
    // For GC purposes.
    (this.produce as unknown) = undefined;
    // For GC purposes.
    this.dispose = undefined;
    let unhandledRejection = false;
    do {
      const handleRejection = this.subscribers.handleRejection;
      if (handleRejection) {
        try {
          handleRejection(this.result as Error);
        } catch (error) {
          throwInMicrotask(error);
        }
        // For GC purposes: unsubscribe handle keeps a reference to the
        // subscriber.
        delete this.subscribers.handleRejection;
      } else {
        unhandledRejection = true;
      }
      // For GC purposes: unsubscribe handle keeps a reference to the
      // subscriber.
      delete this.subscribers.handleValue;
      // For GC purposes: unsubscribe handle keeps a reference to the
      // subscriber.
      delete this.subscribers.handleFailure;
      this.subscribers = this.subscribers.next;
    } while (this.subscribers);
    if (unhandledRejection) {
      throwInMicrotask(wrapRejectionError(this.result));
    }
  }

  private fail(error: unknown) {
    if (this.status === neverSymbol) {
      throw new Error(noDisposeErrorMessage(failedSymbol));
    }
    if (this.status) {
      throw new Error(alreadySettledErrorMessage(failedSymbol, this.status));
    }
    if (!this.subscribers) {
      throw new Error(disposedErrorMessage(failedSymbol));
    }
    this.result = error;
    this.status = failedSymbol;
    // For GC purposes.
    (this.produce as unknown) = undefined;
    // For GC purposes.
    this.dispose = undefined;
    let unhandledFailure = false;
    do {
      const handleFailure = this.subscribers.handleFailure;
      if (handleFailure) {
        try {
          handleFailure(error);
        } catch (error) {
          throwInMicrotask(error);
        }
        // For GC purposes: unsubscribe handle keeps a reference to the
        // subscriber.
        delete this.subscribers.handleFailure;
      } else {
        unhandledFailure = true;
      }
      // For GC purposes: unsubscribe handle keeps a reference to the
      // subscriber.
      delete this.subscribers.handleValue;
      // For GC purposes: unsubscribe handle keeps a reference to the
      // subscriber.
      delete this.subscribers.handleRejection;
      this.subscribers = this.subscribers.next;
    } while (this.subscribers);
    if (unhandledFailure) {
      throwInMicrotask(this.result);
    }
  }

  private unsubscribe(subscriber: Subscriber<Value, Error>) {
    if (this.status || !this.subscribers) {
      return;
    } else {
      if (subscriber.previous) {
        if (subscriber.next) {
          subscriber.previous.next = subscriber.next;
          subscriber.next.previous = subscriber.previous;
          // For GC purposes.
          delete subscriber.next;
        } else {
          delete subscriber.previous.next;
        }
        delete subscriber.previous;
      } else {
        if (this.subscribers !== subscriber) {
          return;
        }
        if (subscriber.next) {
          this.subscribers = subscriber.next;
          delete subscriber.next.previous;
          // For GC purposes.
          delete subscriber.next;
        } else {
          this.subscribers = undefined;
          try {
            this.dispose!();
          } catch (error) {
            this.status = failedSymbol;
            this.result = error;
            // For GC purposes.
            (this.produce as unknown) = undefined;
            throwInMicrotask(error);
          }
          this.dispose = undefined;
        }
      }
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
    if (this.status === neverSymbol) {
      return noopUnsubscribe;
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
      if (!this.dispose) {
        throw new Error(cannotSubscribeInProduceMessage);
      }
      this.subscribers.previous = subscriber;
      subscriber.next = this.subscribers;
      this.subscribers = subscriber;
    } else {
      if (this.dispose) {
        throw new Error(cannotSubscribeInDisposeMessage);
      }
      this.subscribers = subscriber;
      try {
        const dispose = this.produce(
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
          if (dispose && dispose !== noopUnsubscribe) {
            this.dispose = dispose;
          } else {
            this.status = neverSymbol;
            this.subscribers = undefined;
            return noopUnsubscribe;
          }
        } else {
          return noopUnsubscribe;
        }
      } catch (error) {
        if (this.status) {
          throwInMicrotask(error);
        } else {
          this.fail(error);
        }
        return noopUnsubscribe;
      }
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
    return new LazyPromiseIterator(this as any);
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

const neverSubscribe = () => noopUnsubscribe;

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
