const emptySymbol = Symbol("empty");
declare const yieldableSymbol: unique symbol;
declare const stabilizerSymbol: unique symbol;

const disposedErrorMessage = (action: string) =>
  `You cannot settle a lazy promise subscription which has been disposed. A subscription is disposed when it is resolved, rejected, failed, unsubscribed, or when the lazy promise constructor callback does not return a teardown function. This specific error occurred when ${action} that has been stored as .cause property.`;

const resolveErrorMessage = disposedErrorMessage(
  `resolve(...) was called with a value`,
);
const rejectErrorMessage = disposedErrorMessage(
  `reject(...) was called with an error`,
);
const failErrorMessage = disposedErrorMessage(
  `fail(...) was called with an error`,
);
const throwErrorMessage = disposedErrorMessage(
  `the lazy promise constructor threw an error`,
);

// We throw failure errors as they are, but when there is an unhandled
// rejection, we wrap it before throwing because (1) failure to handle a
// rejection is itself an error and (2) it's normal for rejection errors to be
// something other than Error instances, and so to not have a stack trace.
const wrapRejectionError = (error: unknown) =>
  new Error(
    `Unhandled rejection. The original error has been stored as the .cause property.`,
    { cause: error },
  );

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
  constructor(
    private produce: (
      resolve: (value: Value) => void,
      reject: (error: Error) => void,
      fail: (error: unknown) => void,
    ) => (() => void) | void,
  ) {}

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
  ): (() => void) | undefined {
    let dispose: (() => void) | void | typeof emptySymbol = emptySymbol;
    try {
      const disposeLocal = this.produce(
        (value) => {
          if (!dispose) {
            throw new Error(resolveErrorMessage, { cause: value });
          }
          dispose = undefined;
          if (handleValue) {
            try {
              handleValue(value);
            } catch (error) {
              throwInMicrotask(error);
            }
          }

          // For GC purposes.
          handleValue = undefined;
          handleRejection = undefined as any;
          handleFailure = undefined;
        },
        (error) => {
          if (!dispose) {
            throw new Error(rejectErrorMessage, { cause: error });
          }
          dispose = undefined;
          if (handleRejection) {
            try {
              handleRejection(error);
            } catch (error) {
              throwInMicrotask(error);
            }
          } else {
            throwInMicrotask(wrapRejectionError(error));
          }

          // For GC purposes.
          handleValue = undefined;
          handleRejection = undefined as any;
          handleFailure = undefined;
        },
        (error) => {
          if (!dispose) {
            throw new Error(failErrorMessage, { cause: error });
          }
          dispose = undefined;
          if (handleFailure) {
            try {
              handleFailure(error);
            } catch (error) {
              throwInMicrotask(error);
            }
          } else {
            throwInMicrotask(error);
          }

          // For GC purposes.
          handleValue = undefined;
          handleRejection = undefined as any;
          handleFailure = undefined;
        },
      );
      if (dispose === emptySymbol) {
        dispose = disposeLocal;
      }
    } catch (error) {
      if (!dispose) {
        throwInMicrotask(Error(throwErrorMessage, { cause: error }));
        return;
      }
      dispose = undefined;
      if (handleFailure) {
        try {
          handleFailure(error);
        } catch (error) {
          throwInMicrotask(error);
        }
      } else {
        throwInMicrotask(error);
      }
      return;
    }
    if (dispose) {
      return () => {
        if (!dispose) {
          return;
        }
        try {
          const disposeLocal = dispose as () => void;
          dispose = undefined;
          disposeLocal();
        } catch (error) {
          throwInMicrotask(error);
        }
        // For GC purposes.
        dispose = undefined;
        handleValue = undefined;
        handleRejection = undefined as any;
        handleFailure = undefined;
      };
    }
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
): undefined {
  try {
    resolve?.(this.result);
  } catch (error) {
    throwInMicrotask(error);
  }
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
): undefined {
  if (reject) {
    try {
      reject(this.result);
    } catch (error) {
      throwInMicrotask(error);
    }
  } else {
    throwInMicrotask(this.result);
  }
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
): undefined {
  if (fail) {
    try {
      fail(this.result);
    } catch (error) {
      throwInMicrotask(error);
    }
  } else {
    throwInMicrotask(this.result);
  }
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

const neverSubscribe = () => undefined;

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
