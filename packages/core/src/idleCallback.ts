import type { LazyPromise } from "./lazyPromise";
import { createLazyPromise } from "./lazyPromise";

/**
 * Takes optional IdleRequestOptions, and returns a lazy promise that resolves
 * with `IdleDeadline` in an idle callback.
 */
export const idleCallback = (
  options?: IdleRequestOptions,
): LazyPromise<IdleDeadline, never> =>
  createLazyPromise((resolve) => {
    const id = requestIdleCallback(resolve, options);
    return () => {
      cancelIdleCallback(id);
    };
  });
