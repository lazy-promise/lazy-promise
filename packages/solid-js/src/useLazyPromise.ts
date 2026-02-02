import type { LazyPromise } from "@lazy-promise/core";
import { getOwner, onCleanup, runWithOwner } from "solid-js";

/**
 * Subscribes to a lazy promise and unsubscribes when the scope is disposed. The
 * error type of the lazy promise must be `never`. To error out the scope, fail
 * the lazy promise.
 */
export const useLazyPromise: <Value>(
  lazyPromise: LazyPromise<Value, never>,
) => void = (lazyPromise) => {
  const owner = getOwner();
  const unsubscribe = runWithOwner(null, () =>
    lazyPromise.subscribe(
      undefined,
      (error: unknown) => {
        const newError = new Error(
          `The lazy promise passed to useLazyPromise(...) has rejected. The original error has been stored as the .cause property.`,
          { cause: error },
        );
        runWithOwner(owner, () => {
          throw newError;
        });
      },
      (error) => {
        runWithOwner(owner, () => {
          throw error;
        });
      },
    ),
  );
  if (unsubscribe) {
    onCleanup(unsubscribe);
  }
};
