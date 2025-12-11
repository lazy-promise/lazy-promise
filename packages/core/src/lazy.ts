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
 * Converts a Promise to a LazyPromise. If the callback throws or the Promise
 * it returns rejects, the LazyPromise fails, so if your promise can reject
 * because of something other than a bug, make sure to `catchFailure`, e.g.
 *
 * '''
 * pipe(
 *   // Returns a `LazyPromise<..., never>`.
 *   lazy(...),
 *   // Redirect failures to the rejection channel, so the resulting lazy
 *   // promise has type `LazyPromise<..., unknown>`.
 *   catchFailure(rejected),
 * );
 * '''
 *
 * The callback can use an AbortSignal provided as argument.
 */
export const lazy = <Value>(
  callback: (abortSignal: AbortSignal) => PromiseLike<Value>,
): LazyPromise<Value, never> =>
  createLazyPromise((resolve, reject, fail) => {
    const abortController = new AbortController();
    let promise: PromiseLike<Value>;
    try {
      promise = callback(abortController.signal);
    } catch (error) {
      promise = Promise.reject(error);
    }
    promise.then(
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
          fail(error);
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
