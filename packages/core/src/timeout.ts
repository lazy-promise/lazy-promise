import type { LazyPromise } from "./lazyPromise";
import { createLazyPromise } from "./lazyPromise";

/**
 * Takes optional duration in ms, and returns a lazy promise that resolve with a
 * value of type `void` when setTimeout fires.
 *
 * To make a lazy promise settle (resolve, reject or fail) with a delay, pipe it
 * though
 *
 * ```
 * finalize(() => timeout(ms))
 * ```
 *
 * To delay a promise only when it resolves, use
 *
 * ```
 * map((value) => pipe(timeout(ms), map(() => value)))
 * ```
 */
export const timeout = (ms?: number): LazyPromise<void, never> =>
  createLazyPromise((resolve) => {
    const id = setTimeout(resolve, ms);
    return () => {
      clearTimeout(id);
    };
  });
