import { LazyPromise } from "./lazyPromise";

/**
 * Takes optional IdleRequestOptions, and returns a lazy promise that resolves
 * with `IdleDeadline` in an idle callback.
 */
export const inIdleCallback = (
  options?: IdleRequestOptions,
): LazyPromise<IdleDeadline> =>
  new LazyPromise((resolve) => {
    const id = requestIdleCallback(resolve, options);
    return () => {
      cancelIdleCallback(id);
    };
  });
