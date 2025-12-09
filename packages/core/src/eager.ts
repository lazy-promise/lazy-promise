import type { LazyPromise } from "./lazyPromise";

/**
 * Converts a LazyPromise to a Promise.
 */
export const eager = <Value>(
  lazyPromise: LazyPromise<Value, unknown>,
): Promise<Value> =>
  new Promise((resolve, reject) =>
    lazyPromise.subscribe(resolve, reject, reject),
  );
