import type { LazyPromise } from "./lazyPromise";
import { createLazyPromise } from "./lazyPromise";

/**
 * The LazyPromise equivalent of promise.finally(...).
 */
export const finalize =
  <Value, Error>(callback: () => void) =>
  (source: LazyPromise<Value, Error>): LazyPromise<Value, Error> =>
    createLazyPromise((resolve, reject) =>
      source.subscribe(
        (value) => {
          callback();
          resolve(value);
        },
        (error) => {
          callback();
          reject(error);
        },
      ),
    );
