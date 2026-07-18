import type { ErrorBox, LazyPromise } from "@lazy-promise/core";
import { getOwner, onCleanup, runWithOwner } from "solid-js";

/**
 * Subscribes to a lazy promise and unsubscribes when the scope is disposed. The
 * lazy promise must not resolve to an ErrorBox. To error out the scope, reject
 * the lazy promise.
 */
export const useLazyPromise: <Value>(
  lazyPromise: Value extends ErrorBox<any> ? never : LazyPromise<Value>,
) => void = (lazyPromise) => {
  const owner = getOwner();
  const subscription = runWithOwner(null, () =>
    lazyPromise.subscribe({
      reject: (error: unknown) => {
        runWithOwner(owner, () => {
          throw error;
        });
      },
    } as any),
  );
  onCleanup(() => {
    subscription?.dispose();
  });
};
