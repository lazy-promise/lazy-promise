const emptySymbol = Symbol("empty");
const resolveSymbol = Symbol("resolve");
const rejectSymbol = Symbol("reject");
const wrongWaySymbol = Symbol("wrongWay");
const unsubscribeSymbol = Symbol("unsubscribed");
const produceSymbol = Symbol("produce");
declare const yieldableSymbol: unique symbol;
declare const valueTypeSymbol: unique symbol;
declare const errorTypeSymbol: unique symbol;

export class TypedError<const Error> {
  constructor(public readonly error: Error) {}
  declare private brand: any;
}

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

const redundantDisposeErrorMessage = (
  action: typeof resolveSymbol | typeof rejectSymbol,
) =>
  `A lazy promise constructor callback returned a teardown function after having ${statusStr(action)} the subscription.${action === rejectSymbol ? ` The rejection error has been stored as this error's .cause property.` : ``}`;

const disposedErrorMessage = (
  action: typeof resolveSymbol | typeof rejectSymbol,
  status:
    | typeof resolveSymbol
    | typeof rejectSymbol
    | typeof unsubscribeSymbol
    | void,
) =>
  status === unsubscribeSymbol
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

class Subscription<Value> {
  dispose:
    | typeof emptySymbol // Initial value.
    // Teardown function has been invoked from `produce` of an inner promise. In
    // this case we let `produce` finish, but discard any value or error it
    // settles to, and then call the returned teardown function if any.
    | typeof wrongWaySymbol
    | typeof resolveSymbol // Subscription has been resolved.
    | typeof rejectSymbol // Subscription has been rejected.
    | (() => void) // `produce` returned a teardown function.
    | void // `produce` returned `void`.
    // Teardown function has been invoked and no `produce` function is running.
    | typeof unsubscribeSymbol = emptySymbol;

  constructor(
    public handleValue: ((value: Value) => void) | void,
    public handleError: ((error: unknown) => void) | void,
  ) {}

  subscribe(
    produce: (
      // eslint-disable-next-line no-use-before-define
      resolve: (value: Value | LazyPromise<Value>) => void,
      reject: (error: unknown) => void,
    ) => (() => void) | void,
  ) {
    while (true) {
      let resolvedWithAPromise = false;
      try {
        const dispose = produce(
          (value) => {
            if (resolvedWithAPromise === true) {
              throw new Error(
                disposedErrorMessage(resolveSymbol, resolveSymbol),
              );
            }
            if (
              this.dispose === resolveSymbol ||
              this.dispose === rejectSymbol ||
              this.dispose === unsubscribeSymbol ||
              !this.dispose
            ) {
              throw new Error(
                disposedErrorMessage(resolveSymbol, this.dispose),
              );
            }
            // eslint-disable-next-line no-use-before-define
            if (value instanceof LazyPromise) {
              resolvedWithAPromise = true;
              if (this.dispose === emptySymbol) {
                // Use the while loop to avoid increasing stack depth.
                produce = value[produceSymbol];
                return;
              }
              if (this.dispose === wrongWaySymbol) {
                return;
              }
              // If we're here, `resolve` was called asynchronously and
              // `this.dispose` is `() => void`.
              this.dispose = emptySymbol;
              this.subscribe(value[produceSymbol]);
              return;
            }
            if (this.dispose === wrongWaySymbol) {
              this.dispose = resolveSymbol;
              return;
            }
            // Here `this.dispose` is `emptySymbol` or `() => void`.
            this.dispose = resolveSymbol;
            if (this.handleValue) {
              try {
                this.handleValue(value);
              } catch (error) {
                throwInMicrotask(error);
              }
            } else if (value instanceof TypedError) {
              throwInMicrotask(wrapTypedError(value.error));
            }

            // For GC purposes.
            this.handleValue = undefined;
            this.handleError = undefined;
          },
          (error) => {
            if (resolvedWithAPromise === true) {
              throw new Error(
                disposedErrorMessage(rejectSymbol, resolveSymbol),
                { cause: error },
              );
            }
            if (
              this.dispose === resolveSymbol ||
              this.dispose === rejectSymbol ||
              this.dispose === unsubscribeSymbol ||
              !this.dispose
            ) {
              throw new Error(
                disposedErrorMessage(rejectSymbol, this.dispose),
                { cause: error },
              );
            }
            if (this.dispose === wrongWaySymbol) {
              this.dispose = rejectSymbol;
              return;
            }
            // Here `this.dispose` is `emptySymbol` or `() => void`.
            this.dispose = rejectSymbol;

            if (this.handleError) {
              try {
                this.handleError(error);
              } catch (error) {
                throwInMicrotask(error);
              }
            } else {
              throwInMicrotask(error);
            }

            // For GC purposes.
            this.handleValue = undefined;
            this.handleError = undefined;
          },
        );
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (resolvedWithAPromise) {
          if (dispose) {
            throwInMicrotask(
              new Error(redundantDisposeErrorMessage(resolveSymbol)),
            );
          }
          continue;
        }
        if (this.dispose === resolveSymbol || this.dispose === rejectSymbol) {
          if (dispose) {
            throwInMicrotask(
              new Error(redundantDisposeErrorMessage(resolveSymbol)),
            );
          }
          return;
        }
        if (this.dispose === wrongWaySymbol) {
          this.dispose = unsubscribeSymbol;
          try {
            dispose?.();
          } catch (error) {
            throwInMicrotask(error);
          }
          return;
        }
        if (this.dispose === emptySymbol) {
          this.dispose = dispose;
          // For GC purposes.
          if (!dispose) {
            this.handleValue = undefined;
            this.handleError = undefined;
          }
        }
      } catch (error) {
        if ((resolvedWithAPromise as boolean) === true) {
          throwInMicrotask(
            new Error(threwErrorMessage(resolveSymbol), {
              cause: error,
            }),
          );
          return;
        }
        if (this.dispose === resolveSymbol || this.dispose === rejectSymbol) {
          throwInMicrotask(
            new Error(threwErrorMessage(this.dispose), {
              cause: error,
            }),
          );
          return;
        }
        if (this.dispose === wrongWaySymbol) {
          this.dispose = rejectSymbol;
          return;
        }
        // Here `this.dispose` is `emptySymbol` or `() => void`.
        this.dispose = rejectSymbol;

        if (this.handleError) {
          try {
            this.handleError(error);
          } catch (error) {
            throwInMicrotask(error);
          }
        } else {
          throwInMicrotask(error);
        }

        // For GC purposes.
        this.handleValue = undefined;
        this.handleError = undefined;
      }
      return;
    }
  }
}

/**
 * A Promise-like primitive which is lazy/cancelable, has typed errors, and
 * emits synchronously instead of on the microtask queue.
 */
export class LazyPromise<Value> {
  [produceSymbol]: (
    // eslint-disable-next-line no-use-before-define
    resolve: (value: Value | LazyPromise<Value>) => void,
    reject: (error: unknown) => void,
  ) => (() => void) | void;

  constructor(
    produce: (
      resolve: (value: Value | LazyPromise<Value>) => void,
      reject: (error: unknown) => void,
    ) => (() => void) | void,
  ) {
    this[produceSymbol] = produce;
  }

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
    const subscription = new Subscription(handleValue, handleError);

    // For GC purposes.
    handleValue = undefined as any;
    handleError = undefined;

    subscription.subscribe(this[produceSymbol]);
    if (typeof subscription.dispose === "function") {
      return () => {
        if (typeof subscription.dispose === "function") {
          const dispose = subscription.dispose;
          subscription.dispose = unsubscribeSymbol;
          try {
            dispose();
          } catch (error) {
            throwInMicrotask(error);
          }

          // For GC purposes.
          subscription.handleValue = undefined;
          subscription.handleError = undefined;
        }
        if (subscription.dispose === emptySymbol) {
          subscription.dispose = wrongWaySymbol;

          // For GC purposes.
          subscription.handleValue = undefined;
          subscription.handleError = undefined;
        }
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
  return new LazyPromise((resolve) => {
    resolve(arg);
  });
};

/**
 * Returns a LazyPromise which synchronously rejects with the provided error.
 */
export const rejected = (error?: unknown): LazyPromise<never> =>
  new LazyPromise((resolve, reject) => {
    reject(error);
  });

/**
 * A LazyPromise which never resolves or rejects.
 */
export const never: LazyPromise<never> = new LazyPromise(() => {});

/**
 * Infers the type of the value the lazy promise resolves to, excluding typed
 * errors.
 */
export type LazyPromiseValue<T extends LazyPromise<any>> =
  T[typeof valueTypeSymbol];

/**
 * Infers the type parameter of `TypedError` that the lazy promise can resolve
 * to.
 */
export type LazyPromiseError<T extends LazyPromise<any>> =
  T[typeof errorTypeSymbol];
