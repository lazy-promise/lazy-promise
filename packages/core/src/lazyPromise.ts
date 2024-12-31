const lazyPromiseSymbol = Symbol("lazyPromise");
const resolvedSymbol = Symbol("resolved");
const rejectedSymbol = Symbol("rejected");

/**
 * Like a Promise, but
 *
 * - Is lazy and cancelable
 *
 * - Has typed errors
 *
 * - Does not use microtask queue
 */
export interface LazyPromise<Value, Error = never> {
  subscribe: [Error] extends [never]
    ? (
        resolve?: ((value: Value) => void) | undefined,
        reject?: ((error: Error) => void) | undefined,
      ) => () => void
    : (
        resolve: ((value: Value) => void) | undefined,
        reject: (error: Error) => void,
      ) => () => void;
  [lazyPromiseSymbol]: true;
}

interface Subscriber<Value, Error> {
  resolve?: (value: Value) => void;
  reject?: (error: Error) => void;
}

const alreadySettledErrorMessage = `You cannot resolve or reject a lazy promise that was already resolved or rejected.`;
const noSubscribersErrorMessage = `You cannot resolve or reject a lazy promise that no longer has any subscribers. Make sure that when you create the promise using createLazyPromise, you return a working teardown function.`;

const voidFunction = () => {};

const throwInMicrotask = (error: unknown) => {
  queueMicrotask(() => {
    throw error;
  });
};

/**
 * Creates a LazyPromise. The callback optionally returns a teardown function.
 */
export const createLazyPromise = <Value, Error = never>(
  produce: (
    resolve: (value: Value) => void,
    reject: (error: Error) => void,
  ) => (() => void) | void,
): LazyPromise<Value, Error> => {
  let status: undefined | typeof resolvedSymbol | typeof rejectedSymbol;
  let result: undefined | Value | Error;
  let subscribers: Subscriber<Value, Error>[] | undefined;
  let dispose: (() => void) | undefined;

  const produceResolve = (value: Value) => {
    if (status) {
      throw new Error(alreadySettledErrorMessage);
    }
    if (!subscribers) {
      throw new Error(noSubscribersErrorMessage);
    }
    result = value;
    status = resolvedSymbol;
    // For GC purposes.
    (produce as unknown) = undefined;
    for (let i = 0; i < subscribers.length; i++) {
      const resolve = subscribers[i]!.resolve;
      if (resolve) {
        try {
          resolve(result);
        } catch (error) {
          throwInMicrotask(error);
        }
      }
    }
    subscribers = undefined;
  };

  const produceReject = (error: Error) => {
    if (status) {
      throw new Error(alreadySettledErrorMessage);
    }
    if (!subscribers) {
      throw new Error(noSubscribersErrorMessage);
    }
    result = error;
    status = rejectedSymbol;
    // For GC purposes.
    (produce as unknown) = undefined;
    let unhandledRejection = false;
    for (let i = 0; i < subscribers.length; i++) {
      try {
        const reject = subscribers[i]!.reject;
        if (reject) {
          reject(result);
        } else {
          unhandledRejection = true;
        }
      } catch (error) {
        throwInMicrotask(error);
      }
    }
    if (unhandledRejection) {
      throwInMicrotask(result);
    }
    subscribers = undefined;
  };

  return {
    subscribe: (
      resolve?: (value: Value) => void,
      reject?: (error: Error) => void,
    ) => {
      if (status === resolvedSymbol) {
        if (resolve) {
          try {
            resolve(result as Value);
          } catch (error) {
            throwInMicrotask(error);
          }
        }
        return voidFunction;
      }
      if (status === rejectedSymbol) {
        if (reject) {
          try {
            reject(result as Error);
          } catch (error) {
            throwInMicrotask(error);
          }
        } else {
          throwInMicrotask(result);
        }
        return voidFunction;
      }
      const subscriber: Subscriber<Value, Error> = {};
      if (resolve) {
        subscriber.resolve = resolve;
      }
      if (reject) {
        subscriber.reject = reject;
      }
      if (subscribers) {
        subscribers.push(subscriber);
      } else {
        subscribers = [subscriber];
        try {
          const retVal = produce(produceResolve, produceReject) as
            | (() => void)
            | undefined;
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
          if (subscribers) {
            dispose = retVal;
          }
        } catch (error) {
          throwInMicrotask(error);
        }
      }
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (status) {
        return voidFunction;
      }
      return () => {
        if (status || !subscribers) {
          return;
        } else if (subscribers.length === 1) {
          if (subscribers[0] !== subscriber) {
            return;
          }
          subscribers = undefined;
          if (dispose) {
            try {
              dispose();
            } catch (error) {
              throwInMicrotask(error);
            }
            // For GC purposes.
            dispose = undefined;
          }
        } else {
          const swap = subscribers.indexOf(subscriber);
          if (swap === -1) {
            return;
          }
          subscribers[swap] = subscribers[subscribers.length - 1]!;
          subscribers.pop();
        }
      };
    },
    [lazyPromiseSymbol]: true,
  };
};

/**
 * Returns a LazyPromise which is already resolved.
 */
export const resolved = <Value>(value: Value): LazyPromise<Value, never> => ({
  subscribe: (resolve?: (value: Value) => void) => {
    try {
      resolve?.(value);
    } catch (error) {
      throwInMicrotask(error);
    }
    return voidFunction;
  },
  [lazyPromiseSymbol]: true,
});

/**
 * Returns a LazyPromise which is already rejected.
 */
export const rejected = <Error>(error: Error): LazyPromise<never, Error> => ({
  subscribe: (
    resolve?: (value: never) => void,
    reject?: (error: Error) => void,
  ) => {
    if (reject) {
      try {
        reject(error);
      } catch (error) {
        throwInMicrotask(error);
      }
    } else {
      throwInMicrotask(error);
    }
    return voidFunction;
  },
  [lazyPromiseSymbol]: true,
});

/**
 * A LazyPromise which never resolves or rejects.
 */
export const never: LazyPromise<never, never> = {
  subscribe: () => voidFunction,
  [lazyPromiseSymbol]: true,
};

export const isLazyPromise = (
  value: unknown,
): value is LazyPromise<unknown, unknown> =>
  typeof value === "object" && value !== null && lazyPromiseSymbol in value;

export type LazyPromiseValue<T> =
  T extends LazyPromise<infer Value, unknown> ? Value : never;

export type LazyPromiseError<T> =
  T extends LazyPromise<unknown, infer Error> ? Error : never;
