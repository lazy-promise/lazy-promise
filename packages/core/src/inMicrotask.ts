import { LazyPromise } from "./lazyPromise";

/**
 * Returns a lazy promise that resolves in a microtask with a value of type
 * `void`.
 *
 * To make an existing lazy promise settle (resolve, reject or fail) in a
 * microtask, pipe it though
 *
 * ```
 * finalize(inMicrotask)
 * ```
 *
 * To limit this to only when the promise resolves, use
 *
 * ```
 * map((value) => inMicrotask().pipe(map(() => value)))
 * ```
 */
export const inMicrotask = (): LazyPromise<void, never> =>
  new LazyPromise((resolve) => {
    let disposed = false;
    queueMicrotask(() => {
      if (!disposed) {
        resolve();
      }
    });
    return () => {
      disposed = true;
    };
  });
