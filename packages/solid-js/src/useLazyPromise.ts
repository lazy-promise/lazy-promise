import type { LazyPromise } from "@lazy-promise/core";
import { noopUnsubscribe } from "@lazy-promise/core";
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
    lazyPromise.subscribe(undefined, undefined, (error) => {
      runWithOwner(owner, () => {
        throw error;
      });
    }),
  );
  if (unsubscribe && unsubscribe !== noopUnsubscribe) {
    onCleanup(unsubscribe);
  }
};
