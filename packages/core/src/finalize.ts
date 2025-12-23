import type { LazyPromise } from "./lazyPromise";
import { createLazyPromise } from "./lazyPromise";

/**
 * The LazyPromise equivalent of `promise.finally(...)`. The callback is called
 * if the source promise resolves, rejects, or fails.
 */
export const finalize =
  <Value, Error>(callback: () => void) =>
  (source: LazyPromise<Value, Error>): LazyPromise<Value, Error> =>
    createLazyPromise((resolve, reject, fail) => {
      let disposed = false;
      const dispose = source.subscribe(
        (value) => {
          try {
            callback();
          } catch (error) {
            if (disposed) {
              throw error;
            }
            fail(error);
            return;
          }
          if (!disposed) {
            resolve(value);
          }
        },
        (error) => {
          try {
            callback();
          } catch (callbackError) {
            if (disposed) {
              throw callbackError;
            }
            fail(callbackError);
            return;
          }
          if (!disposed) {
            reject(error);
          }
        },
        (error) => {
          try {
            callback();
          } catch (callbackError) {
            if (disposed) {
              throw callbackError;
            }
            fail(callbackError);
            return;
          }
          if (!disposed) {
            fail(error);
          }
        },
      );
      return () => {
        disposed = true;
        dispose();
      };
    });
