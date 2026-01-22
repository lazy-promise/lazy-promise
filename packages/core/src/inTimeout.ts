import { LazyPromise } from "./lazyPromise";

/**
 * Takes optional duration in ms, and returns a lazy promise that resolves with
 * a value of type `void` when setTimeout fires.
 *
 * To make a lazy promise settle (resolve, reject or fail) with a delay, pipe it
 * though
 *
 * ```
 * finalize(() => inTimeout(ms))
 * ```
 *
 * To delay a promise only when it resolves, use
 *
 * ```
 * map((value) => inTimeout(ms).pipe(map(() => value)))
 * ```
 */
export const inTimeout = (ms?: number): LazyPromise<void, never> =>
  new LazyPromise((resolve) => {
    const id = setTimeout(resolve, ms);
    return () => {
      clearTimeout(id);
    };
  });
