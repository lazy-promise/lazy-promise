import type { LazyPromise, Subscription, TypedError } from "@lazy-promise/core";
import { useEffect, useRef } from "react";

/**
 * Entry in the per-hook-instance cache.
 */
interface CacheEntry<T> {
  status: "pending" | "success" | "error";
  value?: T;
  error?: unknown;
  promise: Promise<T>;
  subscription: Subscription;
}

/**
 * Hooks a LazyPromise into React's Suspense system. The component will suspend
 * while the promise is pending, return the resolved value, or throw the error
 * for an Error Boundary to catch.
 *
 * The input LazyPromise must not resolve to a TypedError—use `.catchTypedError()`
 * before passing to this hook if you need to handle typed errors.
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const data = useLazyPromise(lazyPromise);
 *   return <div>{data}</div>;
 * }
 *
 * export default () => (
 *   <Suspense fallback={<div>Loading...</div>}>
 *     <ErrorBoundary fallback={<div>Error!</div>}>
 *       <MyComponent />
 *     </ErrorBoundary>
 *   </Suspense>
 * );
 * ```
 */
const useLazyPromiseImpl = <T>(lazyPromise: LazyPromise<T>): T => {
  const cacheRef = useRef<CacheEntry<T> | null>(null);
  const lazyPromiseRef = useRef<LazyPromise<T> | null>(null);

  // If the lazyPromise reference changed, reset cache and clean up old subscription
  if (lazyPromiseRef.current !== lazyPromise) {
    cacheRef.current?.subscription.unsubscribe();
    cacheRef.current = null;
    lazyPromiseRef.current = lazyPromise;
  }

  // Initialize cache entry on first render
  if (cacheRef.current === null) {
    let resolvePromise: (value: T) => void;
    let rejectPromise: (reason?: unknown) => void;

    const promise = new Promise<T>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });

    const entry = {
      status: "pending",
      promise,
    } as Omit<CacheEntry<T>, "subscription"> & {
      subscription?: Subscription;
    };

    const subscription = lazyPromise.subscribe({
      resolve: (value: T) => {
        entry.status = "success";
        entry.value = value;
        resolvePromise(value);
      },
      reject: (error: unknown) => {
        entry.status = "error";
        entry.error = error;
        rejectPromise(error);
      },
    });

    entry.subscription = subscription;
    cacheRef.current = entry as CacheEntry<T>;
  }

  // Clean up subscription on unmount
  useEffect(
    () => () => {
      cacheRef.current?.subscription.unsubscribe();
    },
    [],
  );

  const entry = cacheRef.current;

  // Throw promise to trigger Suspense
  if (entry.status === "pending") {
    throw entry.promise;
  }

  // Throw error to trigger Error Boundary
  if (entry.status === "error") {
    throw entry.error;
  }

  // Return the resolved value
  return entry.value!;
};

export const useLazyPromise: <T>(
  lazyPromise: Extract<T, TypedError<any>> extends never
    ? LazyPromise<T>
    : never,
) => T = useLazyPromiseImpl as any;
