import type { LazyPromise } from "@lazy-promise/core";
import { getOwner, onCleanup, runWithOwner } from "solid-js";

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
  lazyPromise: LazyPromise<Value, Error>,
  ...args: [Error] extends [never]
    ? [
        handleValue?: ((value: Value) => void) | undefined,
        handleError?: ((error: Error) => void) | undefined,
      ]
    : [
        handleValue: ((value: Value) => void) | undefined,
        handleError: (error: Error) => void,
      ]
) => void = (
  lazyPromise: LazyPromise<any, any>,
  handleValue?: any,
  handleError?: any,
) => {
  const owner = getOwner();
  const unsubscribe = runWithOwner(null, () =>
    lazyPromise.subscribe(handleValue, handleError, (error) => {
      runWithOwner(owner, () => {
        throw error;
      });
    }),
  );
  if (unsubscribe) {
    onCleanup(unsubscribe);
  }
};
