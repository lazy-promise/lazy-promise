import { LazyPromise } from "./lazyPromise";

/**
 * Returns a lazy promise that resolves in a microtask with a value of type
 * `void`.
 *
 * To make an existing lazy promise settle (resolve, reject or fail) in a
 * microtask, pipe it though
 *
 * ```
 * finalize(microtask)
 * ```
 *
 * To limit this to only when the promise resolves, use
 *
 * ```
 * map((value) => microtask().pipe(map(() => value)))
 * ```
 */
export const microtask = (): LazyPromise<void, never> =>
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
