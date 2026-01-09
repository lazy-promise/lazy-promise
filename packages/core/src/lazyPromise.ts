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
        handleFailure?: (error: unknown) => void,
      ) => () => void
    : (
        handleValue: ((value: Value) => void) | undefined,
        handleError: (error: Error) => void,
        handleFailure?: (error: unknown) => void,
      ) => () => void;
  [lazyPromiseSymbol]: true;
}

interface Subscriber<Value, Error> {
  handleValue?: (value: Value) => void;
  handleError?: (error: Error) => void;
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
  `You cannot ${getActionStr(action)} a lazy promise that no longer has any subscribers. Make sure that the callback you're passing to createLazyPromise returns a working teardown function.`;

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

/**
 * Creates a LazyPromise. The callback can return a teardown function.
 */
export const createLazyPromise = <Value, Error = never>(
  produce: (
    resolve: (value: Value) => void,
    reject: (error: Error) => void,
    fail: (error: unknown) => void,
  ) => (() => void) | void,
): LazyPromise<Value, Error> => {
  let status:
    | undefined
    | typeof resolvedSymbol
    | typeof rejectedSymbol
    | typeof failedSymbol;
  let result: unknown;
  let subscribers: Subscriber<Value, Error>[] | undefined;
  let dispose: (() => void) | undefined;

  const resolve = (value: Value) => {
    if (status) {
      throw new Error(alreadySettledErrorMessage(resolvedSymbol, status));
    }
    if (!subscribers) {
      throw new Error(noSubscribersErrorMessage(resolvedSymbol));
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
          handleValue(result as Value);
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
      throw new Error(noSubscribersErrorMessage(rejectedSymbol));
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
          handleError(result as Error);
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
      throwInMicrotask(wrapRejectionError(result));
    }
    subscribers = undefined;
  };

  const fail = (error: unknown) => {
    if (status) {
      throw new Error(alreadySettledErrorMessage(failedSymbol, status));
    }
    if (!subscribers) {
      throw new Error(noSubscribersErrorMessage(failedSymbol));
    }
    result = error;
    status = failedSymbol;
    // For GC purposes.
    (produce as unknown) = undefined;
    // For GC purposes.
    dispose = undefined;
    let unhandledFailure = false;
    for (let i = 0; i < subscribers.length; i++) {
      const handleFailure = subscribers[i]!.handleFailure;
      if (handleFailure) {
        try {
          handleFailure(error);
        } catch (error) {
          throwInMicrotask(error);
        }
        // For GC purposes: unsubscribe handle keeps a reference to the
        // subscriber.
        delete subscribers[i]!.handleFailure;
      } else {
        unhandledFailure = true;
      }
      // For GC purposes: unsubscribe handle keeps a reference to the
      // subscriber.
      delete subscribers[i]!.handleValue;
      // For GC purposes: unsubscribe handle keeps a reference to the
      // subscriber.
      delete subscribers[i]!.handleError;
    }
    if (unhandledFailure) {
      throwInMicrotask(result);
    }
    subscribers = undefined;
  };

  return {
    subscribe: (
      handleValue?: (value: Value) => void,
      handleError?: (error: Error) => void,
      handleFailure?: (error: unknown) => void,
    ) => {
      if (status === resolvedSymbol) {
        if (handleValue) {
          try {
            handleValue(result as Value);
          } catch (error) {
            throwInMicrotask(error);
          }
        }
        return noopUnsubscribe;
      }
      if (status === rejectedSymbol) {
        if (handleError) {
          try {
            handleError(result as Error);
          } catch (error) {
            throwInMicrotask(error);
          }
        } else {
          throwInMicrotask(wrapRejectionError(result));
        }
        return noopUnsubscribe;
      }
      if (status === failedSymbol) {
        if (handleFailure) {
          try {
            handleFailure(result);
          } catch (error) {
            throwInMicrotask(error);
          }
        } else {
          throwInMicrotask(result);
        }
        return noopUnsubscribe;
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
            fail(error);
          } else {
            throwInMicrotask(error);
          }
        }
      }
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (status) {
        return noopUnsubscribe;
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
              status = failedSymbol;
              result = error;
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
export const resolved: {
  <const Value>(value: Value): LazyPromise<Value, never>;
  (): LazyPromise<void, never>;
} = (value?: any): LazyPromise<any, never> => ({
  subscribe: (resolve?: (value: any) => void) => {
    try {
      resolve?.(value);
    } catch (error) {
      throwInMicrotask(error);
    }
    return noopUnsubscribe;
  },
  [lazyPromiseSymbol]: true,
});

/**
 * Returns a LazyPromise which is already rejected.
 */
export const rejected: {
  <const Error>(error: Error): LazyPromise<never, Error>;
  (): LazyPromise<never, void>;
} = (error?: any): LazyPromise<never, any> => ({
  subscribe: (
    resolve?: (value: never) => void,
    reject?: (error: any) => void,
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
    return noopUnsubscribe;
  },
  [lazyPromiseSymbol]: true,
});

/**
 * Returns a LazyPromise which is already failed.
 */
export const failed = (error?: unknown): LazyPromise<never, never> => ({
  subscribe: (
    resolve?: (value: never) => void,
    reject?: (error: never) => void,
    fail?: (error: unknown) => void,
  ) => {
    if (fail) {
      try {
        fail(error);
      } catch (error) {
        throwInMicrotask(error);
      }
    } else {
      throwInMicrotask(error);
    }
    return noopUnsubscribe;
  },
  [lazyPromiseSymbol]: true,
});

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

/**
 * A LazyPromise which never resolves, rejects or fails.
 */
export const never: LazyPromise<never, never> = {
  subscribe: () => neverUnsubscribe,
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
