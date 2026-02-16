const emptySymbol = Symbol("empty");
const resolveSymbol = Symbol("resolve");
const rejectSymbol = Symbol("reject");
const unsubscribedSymbol = Symbol("unsubscribed");
declare const yieldableSymbol: unique symbol;
declare const valueTypeSymbol: unique symbol;
declare const errorTypeSymbol: unique symbol;

export class TypedError<const Error> {
  constructor(public readonly error: Error) {}
  declare private brand: any;
}

export type TypedErrorOrNever<Error> = Error extends never
  ? never
  : TypedError<Error>;

const actionStr = (action: typeof resolveSymbol | typeof rejectSymbol) =>
  action === resolveSymbol
    ? `resolve`
    : (action satisfies typeof rejectSymbol, `reject`);

const statusStr = (action: typeof resolveSymbol | typeof rejectSymbol) =>
  action === resolveSymbol
    ? `resolved`
    : (action satisfies typeof rejectSymbol, `rejected`);

const alreadySettledErrorMessage = (
  action: typeof resolveSymbol | typeof rejectSymbol,
  status: typeof resolveSymbol | typeof rejectSymbol,
) =>
  `Tried to ${actionStr(action)} ${action === status ? `an already` : `a`} ${statusStr(status)} lazy promise subscription${action === rejectSymbol ? ` with an error that has been stored as this error's .cause property` : ``}.`;

const threwErrorMessage = (
  status: typeof resolveSymbol | typeof rejectSymbol,
) =>
  `A lazy promise constructor callback threw an error after having previously ${statusStr(status)} the subscription. The error has been stored as this error's .cause property.`;

const unsubscribedErrorMessage = (
  action: typeof resolveSymbol | typeof rejectSymbol,
) =>
  `Tried to ${actionStr(action)} a lazy promise subscription after the teardown function was called.${action === rejectSymbol ? ` The rejection error has been stored as this error's .cause property.` : ``}`;

const noDisposeErrorMessage = (
  action: typeof resolveSymbol | typeof rejectSymbol,
) =>
  `Tried to asynchronously ${actionStr(action)} a lazy promise subscription that does not have a teardown function.${action === rejectSymbol ? ` The rejection error has been stored as this error's .cause property.` : ``}`;

const disposedErrorMessage = (
  action: typeof resolveSymbol | typeof rejectSymbol,
  status:
    | typeof resolveSymbol
    | typeof rejectSymbol
    | typeof unsubscribedSymbol
    | undefined,
) =>
  status === unsubscribedSymbol
    ? unsubscribedErrorMessage(action)
    : status === undefined
      ? noDisposeErrorMessage(action)
      : alreadySettledErrorMessage(action, status);

// We throw rejection errors as they are, but when there is an unhandled typed
// error, we wrap it before throwing because (1) failure to handle a typed error
// is itself an error and (2) it's normal for typed errors to be something other
// than Error instances, and so to not have a stack trace.
const wrapTypedError = (error: any) =>
  new Error(
    `Unhandled typed error. The original error has been stored as the .cause property.`,
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

  throw(error: unknown): IteratorResult<TYield> {
    throw error;
  }
}

/**
 * A Promise-like primitive which is lazy/cancelable, has typed errors, and
 * emits synchronously instead of on the microtask queue.
 */
export class LazyPromise<Value> {
  constructor(
    private produce: (
      resolve: (value: Value) => void,
      reject: (error: unknown) => void,
    ) => (() => void) | void,
  ) {}

  /**
   * Subscribes to the lazy promise. Value handler is required if the value can
   * be a TypedError.
   */
  subscribe(
    handleValue: this[typeof errorTypeSymbol] extends never
      ? ((value: Value) => void) | void
      : (value: Value) => void,
    handleError: ((error: unknown) => void) | void,
  ): (() => void) | undefined {
    let dispose: (() => void) | void | typeof emptySymbol = emptySymbol;
    // Used for error messages.
    let status:
      | typeof resolveSymbol
      | typeof rejectSymbol
      | typeof unsubscribedSymbol
      | undefined;
    try {
      const disposeLocal = this.produce(
        (value) => {
          if (!dispose) {
            throw new Error(disposedErrorMessage(resolveSymbol, status));
          }
          dispose = undefined;
          status = resolveSymbol;
          if (handleValue) {
            try {
              handleValue(value);
            } catch (error) {
              throwInMicrotask(error);
            }
          } else if (value instanceof TypedError) {
            throwInMicrotask(wrapTypedError(value.error));
          }

          // For GC purposes.
          handleValue = undefined as any;
          handleError = undefined;
        },
        (error) => {
          if (!dispose) {
            throw new Error(disposedErrorMessage(rejectSymbol, status), {
              cause: error,
            });
          }
          dispose = undefined;
          status = rejectSymbol;
          if (handleError) {
            try {
              handleError(error);
            } catch (error) {
              throwInMicrotask(error);
            }
          } else {
            throwInMicrotask(error);
          }

          // For GC purposes.
          handleValue = undefined as any;
          handleError = undefined;
        },
      );
      if (dispose === emptySymbol) {
        dispose = disposeLocal;
      }
    } catch (error) {
      if (!dispose) {
        throwInMicrotask(
          new Error(
            threwErrorMessage(
              status as typeof resolveSymbol | typeof rejectSymbol,
            ),
            { cause: error },
          ),
        );
        return;
      }
      dispose = undefined;
      if (handleError) {
        try {
          handleError(error);
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
        const disposeLocal = dispose as () => void;
        dispose = undefined;
        status = unsubscribedSymbol;
        try {
          disposeLocal();
        } catch (error) {
          throwInMicrotask(error);
        }
        // For GC purposes.
        handleValue = undefined as any;
        handleError = undefined;
      };
    }
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
    next(
      ...args: ReadonlyArray<any>
    ): IteratorResult<Yieldable<LazyPromise<Value>>, Value>;
  } {
    return new LazyPromiseIterator(this as any);
  }

  declare readonly [valueTypeSymbol]: Value extends TypedError<any>
    ? never
    : Value;

  declare readonly [errorTypeSymbol]: Value extends TypedError<infer Error>
    ? Error
    : never;
}

interface SettledLazyPromise {
  result: unknown;
  subscribe: LazyPromise<any>["subscribe"];
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
  const instance = Object.create(LazyPromise.prototype) as SettledLazyPromise;
  instance.result = arg;
  instance.subscribe = resolvedSubscribe;
  return instance;
};

function rejectedSubscribe(
  this: SettledLazyPromise,
  resolve: any,
  reject: ((error: unknown) => void) | void,
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
 * Returns a LazyPromise which synchronously rejects with the provided error.
 */
export const rejected = (error?: unknown): LazyPromise<never> => {
  const instance = Object.create(LazyPromise.prototype) as SettledLazyPromise;
  instance.result = error;
  instance.subscribe = rejectedSubscribe;
  return instance as any;
};

const neverSubscribe = () => undefined;

/**
 * A LazyPromise which never resolves or rejects.
 */
export const never: LazyPromise<never> = Object.create(LazyPromise.prototype);
never.subscribe = neverSubscribe;

export type LazyPromiseValue<T extends LazyPromise<any>> =
  T[typeof valueTypeSymbol];

export type LazyPromiseError<T extends LazyPromise<any>> =
  T[typeof errorTypeSymbol];
