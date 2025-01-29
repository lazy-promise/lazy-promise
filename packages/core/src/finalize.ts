import type { LazyPromise } from "./lazyPromise";
import { createLazyPromise } from "./lazyPromise";

/**
 * The LazyPromise equivalent of `promise.finally(...)`. The callback is called
 * if the source promise resolves, rejects, or fails.
 */
export const finalize =
  <Value, Error>(callback: () => void) =>
  (source: LazyPromise<Value, Error>): LazyPromise<Value, Error> =>
    createLazyPromise((resolve, reject, fail) =>
      source.subscribe(
        (value) => {
          try {
            callback();
          } catch (error) {
            fail();
            throw error;
          }
          resolve(value);
        },
        (error) => {
          try {
            callback();
          } catch (error) {
            fail();
            throw error;
          }
          reject(error);
        },
        () => {
          try {
            callback();
          } catch (error) {
            fail();
            throw error;
          }
          fail();
        },
      ),
    );
