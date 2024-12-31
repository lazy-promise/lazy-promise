import type { LazyPromise } from "./lazyPromise";
import { createLazyPromise } from "./lazyPromise";

// DOMException was only made a global in Node v17.0.0. We use this constant to
// support Node 16.
const DOMException =
  (globalThis as any).DOMException ??
  (() => {
    try {
      atob("~");
    } catch (err) {
      return Object.getPrototypeOf(err).constructor;
    }
  })();

/**
 * Converts a Promise to a LazyPromise.
 */
export const lazy = <Value>(
  callback: (abortSignal: AbortSignal) => PromiseLike<Value>,
): LazyPromise<Value, unknown> =>
  createLazyPromise((resolve, reject) => {
    const abortController = new AbortController();
    callback(abortController.signal).then(
      (value) => {
        if (!abortController.signal.aborted) {
          resolve(value);
        }
      },
      (error) => {
        if (
          !abortController.signal.aborted &&
          !(error instanceof DOMException && error.name === "AbortError")
        ) {
          reject(error);
        }
      },
    );
    return () => {
      abortController.abort(
        new DOMException(
          "The lazy promise no longer has any subscribers.",
          "AbortError",
        ),
      );
    };
  });
