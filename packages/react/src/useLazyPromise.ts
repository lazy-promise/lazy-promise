import type { LazyPromise, Subscription, TypedError } from "@lazy-promise/core";
import { useEffect } from "react";

/**
 * Entry in the shared per-lazy-promise cache.
 */
interface CacheEntry<T> {
  status: "pending" | "success" | "error";
  value?: T;
  error?: unknown;
  promise: Promise<T>;
  subscription: Subscription;
  activeHooks: number;
}

const cacheByPromise = new WeakMap<LazyPromise<any>, CacheEntry<any>>();

const getOrCreateEntry = <T>(lazyPromise: LazyPromise<T>): CacheEntry<T> => {
  const cached = cacheByPromise.get(lazyPromise);
  if (cached) {
    return cached as CacheEntry<T>;
  }

  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (reason?: unknown) => void;

  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  const entry = {
    status: "pending",
    promise,
    activeHooks: 0,
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
  const finalizedEntry = entry as CacheEntry<T>;
  cacheByPromise.set(lazyPromise, finalizedEntry);
  return finalizedEntry;
};

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
  const entry = getOrCreateEntry(lazyPromise);

  // Keep a reference count of mounted hook instances for this lazy promise.
  useEffect(() => {
    entry.activeHooks += 1;
    return () => {
      entry.activeHooks -= 1;
      if (entry.activeHooks === 0 && entry.status === "pending") {
        entry.subscription.unsubscribe();
        cacheByPromise.delete(lazyPromise);
      }
    };
  }, [entry, lazyPromise]);

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
