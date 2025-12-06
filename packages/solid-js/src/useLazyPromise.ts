import type { LazyPromise } from "@lazy-promise/core";
import { onCleanup, runWithOwner } from "solid-js";

/**
 * Subscribes to a lazy promise and unsubscribes when the scope is disposed. All
 * callbacks, whether they're run synchronously or asynchronously, are run
 * outside of the scope (which among other things means no tracking).
 *
 * ```
 * pipe(lazyPromise, useLazyPromise(handleValue, handleError));
 * ```
 *
 * If the error type of your lazy promise is other than `never`, the type system
 * will want you to provide an error handler.
 */
export const useLazyPromise: <Value, Error>(
  ...args: [Error] extends [never]
    ? [
        handleValue?: ((value: Value) => void) | undefined,
        handleError?: ((error: Error) => void) | undefined,
        handleFailure?: () => void,
      ]
    : [
        handleValue: ((value: Value) => void) | undefined,
        handleError: (error: Error) => void,
        handleFailure?: () => void,
      ]
) => (lazyPromise: LazyPromise<Value, Error>) => void =
  (handleValue?: any, handleError?: any, handleFailure?: any) =>
  (lazyPromise: LazyPromise<any, any>) => {
    const unsubscribe = runWithOwner(null, () =>
      lazyPromise.subscribe(handleValue, handleError, handleFailure),
    );
    if (unsubscribe) {
      onCleanup(unsubscribe);
    }
  };
