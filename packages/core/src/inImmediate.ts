import { LazyPromise } from "./lazyPromise";

/**
 * Returns a lazy promise that resolves with a value of type `void` in a
 * setImmediate callback (deprecated outside of Node).
 *
 * To make a lazy promise settle (resolve, reject or fail) via setImmediate,
 * pipe it though
 *
 * ```
 * finalize(inImmediate)
 * ```
 *
 * To limit this to only when the promise resolves, use
 *
 * ```
 * map((value) => inImmediate().pipe(map(() => value)))
 * ```
 */
export const inImmediate = (): LazyPromise<void, never> =>
  new LazyPromise((resolve) => {
    const id = setImmediate(resolve);
    return () => {
      clearImmediate(id);
    };
  });
