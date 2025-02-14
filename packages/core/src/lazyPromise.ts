const lazyPromiseSymbol = Symbol("lazyPromise");
const resolvedSymbol = Symbol("resolved");
const rejectedSymbol = Symbol("rejected");
const failedSymbol = Symbol("failed");

/**
 * A Promise-like primitive which is lazy/cancelable, has typed errors, and
 * emits synchronously instead of on the microtask queue.
 */
export interface LazyPromise<Value, Error = never> {
  subscribe: [Error] extends [never]
    ? (
        handleValue?: ((value: Value) => void) | undefined,
        handleError?: ((error: Error) => void) | undefined,
        handleFailure?: () => void,
      ) => () => void
    : (
        handleValue: ((value: Value) => void) | undefined,
        handleError: (error: Error) => void,
        handleFailure?: () => void,
      ) => () => void;
  [lazyPromiseSymbol]: true;
}

interface Subscriber<Value, Error> {
  handleValue?: (value: Value) => void;
  handleError?: (error: Error) => void;
  handleFailure?: () => void;
}

const alreadySettledErrorMessage = (
  action: typeof resolvedSymbol | typeof rejectedSymbol | typeof failedSymbol,
  status: typeof resolvedSymbol | typeof rejectedSymbol | typeof failedSymbol,
) =>
  `You cannot ${action === resolvedSymbol ? `resolve` : action === rejectedSymbol ? `reject` : (action satisfies typeof failedSymbol, `fail`)} ${action === status ? `an already` : `a`} ${status === resolvedSymbol ? `resolved` : status === rejectedSymbol ? `rejected` : (status satisfies typeof failedSymbol, `failed`)} lazy promise.`;

const noSubscribersErrorMessage = (resolveOrReject: "resolve" | "reject") =>
  `You cannot ${resolveOrReject} a lazy promise that no longer has any subscribers. Make sure that the callback you're passing to createLazyPromise returns a working teardown function.`;

const failErrorMessage = `You cannot fail a lazy promise that no longer has any subscribers, except while its teardown function is running. Make sure that the callback you're passing to createLazyPromise returns a working teardown function.`;

const cannotSubscribeMessage = `You cannot subscribe to a lazy promise while its teardown function is running.`;

const voidFunction = () => {};

const throwInMicrotask = (error: unknown) => {
  queueMicrotask(() => {
    throw error;
  });
};

/**
 * Creates a LazyPromise. The callback can return a teardown function.
 */
export const createLazyPromise = <Value, Error = never>(
  produce: (
    resolve: (value: Value) => void,
    reject: (error: Error) => void,
    fail: () => void,
  ) => (() => void) | void,
): LazyPromise<Value, Error> => {
  let status:
    | undefined
    | typeof resolvedSymbol
    | typeof rejectedSymbol
    | typeof failedSymbol;
  let result: undefined | Value | Error;
  let subscribers: Subscriber<Value, Error>[] | undefined;
  let dispose: (() => void) | undefined;

  const resolve = (value: Value) => {
    if (status) {
      throw new Error(alreadySettledErrorMessage(resolvedSymbol, status));
    }
    if (!subscribers) {
      throw new Error(noSubscribersErrorMessage("resolve"));
    }
    result = value;
    status = resolvedSymbol;
    // For GC purposes.
    (produce as unknown) = undefined;
    // For GC purposes.
    dispose = undefined;
    for (let i = 0; i < subscribers.length; i++) {
      const handleValue = subscribers[i]!.handleValue;
      if (handleValue) {
        try {
          handleValue(result);
        } catch (error) {
          throwInMicrotask(error);
        }
        // For GC purposes: unsubscribe handle keeps a reference to the
        // subscriber.
        delete subscribers[i]!.handleValue;
      }
      // For GC purposes: unsubscribe handle keeps a reference to the
      // subscriber.
      delete subscribers[i]!.handleError;
      // For GC purposes: unsubscribe handle keeps a reference to the
      // subscriber.
      delete subscribers[i]!.handleFailure;
    }
    subscribers = undefined;
  };

  const reject = (error: Error) => {
    if (status) {
      throw new Error(alreadySettledErrorMessage(rejectedSymbol, status));
    }
    if (!subscribers) {
      throw new Error(noSubscribersErrorMessage("reject"));
    }
    result = error;
    status = rejectedSymbol;
    // For GC purposes.
    (produce as unknown) = undefined;
    // For GC purposes.
    dispose = undefined;
    let unhandledRejection = false;
    for (let i = 0; i < subscribers.length; i++) {
      const handleError = subscribers[i]!.handleError;
      if (handleError) {
        try {
          handleError(result);
        } catch (error) {
          throwInMicrotask(error);
        }
        // For GC purposes: unsubscribe handle keeps a reference to the
        // subscriber.
        delete subscribers[i]!.handleError;
      } else {
        unhandledRejection = true;
      }
      // For GC purposes: unsubscribe handle keeps a reference to the
      // subscriber.
      delete subscribers[i]!.handleValue;
      // For GC purposes: unsubscribe handle keeps a reference to the
      // subscriber.
      delete subscribers[i]!.handleFailure;
    }
    if (unhandledRejection) {
      throwInMicrotask(result);
    }
    subscribers = undefined;
  };

  const fail = () => {
    if (status) {
      throw new Error(alreadySettledErrorMessage(failedSymbol, status));
    }
    if (!subscribers && !dispose) {
      throw new Error(failErrorMessage);
    }
    status = failedSymbol;
    // For GC purposes.
    (produce as unknown) = undefined;
    // For GC purposes.
    dispose = undefined;
    if (!subscribers) {
      return;
    }
    for (let i = 0; i < subscribers.length; i++) {
      const handleFailure = subscribers[i]!.handleFailure;
      if (handleFailure) {
        try {
          handleFailure();
        } catch (error) {
          throwInMicrotask(error);
        }
        // For GC purposes: unsubscribe handle keeps a reference to the
        // subscriber.
        delete subscribers[i]!.handleFailure;
      }
      // For GC purposes: unsubscribe handle keeps a reference to the
      // subscriber.
      delete subscribers[i]!.handleValue;
      // For GC purposes: unsubscribe handle keeps a reference to the
      // subscriber.
      delete subscribers[i]!.handleError;
    }
    subscribers = undefined;
  };

  return {
    subscribe: (
      handleValue?: (value: Value) => void,
      handleError?: (error: Error) => void,
      handleFailure?: () => void,
    ) => {
      if (status === resolvedSymbol) {
        if (handleValue) {
          try {
            handleValue(result as Value);
          } catch (error) {
            throwInMicrotask(error);
          }
        }
        return voidFunction;
      }
      if (status === rejectedSymbol) {
        if (handleError) {
          try {
            handleError(result as Error);
          } catch (error) {
            throwInMicrotask(error);
          }
        } else {
          throwInMicrotask(result);
        }
        return voidFunction;
      }
      if (status === failedSymbol) {
        if (handleFailure) {
          try {
            handleFailure();
          } catch (error) {
            throwInMicrotask(error);
          }
        }
        return voidFunction;
      }
      if (!subscribers && dispose) {
        throw new Error(cannotSubscribeMessage);
      }
      const subscriber: Subscriber<Value, Error> = {};
      if (handleValue) {
        subscriber.handleValue = handleValue;
      }
      if (handleError) {
        subscriber.handleError = handleError;
      }
      if (handleFailure) {
        subscriber.handleFailure = handleFailure;
      }
      if (subscribers) {
        subscribers.push(subscriber);
      } else {
        subscribers = [subscriber];
        try {
          const retVal = produce(resolve, reject, fail) as
            | (() => void)
            | undefined;
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
          if (subscribers) {
            dispose = retVal;
          }
        } catch (error) {
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
          if (!status) {
            fail();
          }
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
              // `status` may or may not be `failedSymbol` at this point.
              status = failedSymbol;
              // For GC purposes.
              (produce as unknown) = undefined;
              throwInMicrotask(error);
            }
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
        // For GC purposes.
        delete subscriber.handleValue;
        // For GC purposes.
        delete subscriber.handleError;
        // For GC purposes.
        delete subscriber.handleFailure;
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
