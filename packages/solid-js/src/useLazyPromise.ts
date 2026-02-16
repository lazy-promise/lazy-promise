import type { LazyPromise, TypedError } from "@lazy-promise/core";
import { getOwner, onCleanup, runWithOwner } from "solid-js";

/**
 * Subscribes to a lazy promise and unsubscribes when the scope is disposed. The
 * lazy promise must not resolve to a TypedError. To error out the scope, reject
 * the lazy promise.
 */
export const useLazyPromise: <Value>(
  lazyPromise: Value extends TypedError<any> ? never : LazyPromise<Value>,
) => void = (lazyPromise) => {
  const owner = getOwner();
  const unsubscribe = runWithOwner(null, () =>
    lazyPromise.subscribe(undefined as any, (error) => {
      runWithOwner(owner, () => {
        throw error;
      });
    }),
  );
  if (unsubscribe) {
    onCleanup(unsubscribe);
  }
};
