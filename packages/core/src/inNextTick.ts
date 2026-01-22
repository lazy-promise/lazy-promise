import { LazyPromise } from "./lazyPromise";

/**
 * Returns a lazy promise that resolves with a value of type `void` in
 * process.nextTick (Node-only).
 *
 * To make a lazy promise settle (resolve, reject or fail) via nextTick, pipe it
 * though
 *
 * ```
 * finalize(inNextTick)
 * ```
 *
 * To limit this to only when the promise resolves, use
 *
 * ```
 * map((value) => inNextTick().pipe(map(() => value)))
 * ```
 */
export const inNextTick = (): LazyPromise<void, never> =>
  new LazyPromise((resolve) => {
    let disposed = false;
    process.nextTick(() => {
      if (!disposed) {
        resolve();
      }
    });
    return () => {
      disposed = true;
    };
  });
