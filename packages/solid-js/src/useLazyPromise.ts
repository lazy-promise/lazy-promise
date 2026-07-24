import type { LazyPromise, UnboxError } from "@lazy-promise/core";
import { getOwner, onCleanup, runWithOwner } from "solid-js";

/**
 * Subscribes to a LazyPromise and unsubscribes when the scope is disposed. The
 * LazyPromise must not resolve to an ErrorBox. To error out the scope, reject
 * the LazyPromise.
 */
export const useLazyPromise: <Value>(
  lazyPromise: UnboxError<Value> extends never ? LazyPromise<Value> : never,
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
