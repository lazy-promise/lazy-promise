import type { LazyPromise, TypedError } from "@lazy-promise/core";

/**
 * Starts a LazyPromise subscription and returns an effect-style cleanup
 * function.
 */
const subscribeImpl = <T>(lazyPromise: LazyPromise<T>): (() => void) => {
  const subscription = (lazyPromise.subscribe as any)();
  return () => {
    subscription.unsubscribe();
  };
};

export const subscribe: <T>(
  lazyPromise: Extract<T, TypedError<any>> extends never
    ? LazyPromise<T>
    : never,
) => () => void = subscribeImpl as any;
