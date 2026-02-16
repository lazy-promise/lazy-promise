import type { LazyPromise } from "./lazyPromise";

/**
 * Converts a LazyPromise to a Promise. You can pass an AbortSignal in the
 * options object.
 */
export const toEager = <Value>(
  lazyPromise: LazyPromise<Value>,
  options?: { readonly signal?: AbortSignal },
): Promise<Value> =>
  new Promise((resolve, reject) => {
    const signal = options?.signal;
    if (!signal) {
      lazyPromise.subscribe(resolve, reject);
      return;
    }
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    let listener: (() => void) | undefined = undefined;
    const handleResolve = (value: Value) => {
      if (listener) {
        signal.removeEventListener("abort", listener);
      }
      resolve(value);
    };
    const handleReject = (error: unknown) => {
      if (listener) {
        signal.removeEventListener("abort", listener);
      }
      reject(error);
    };
    const unsubscribe = lazyPromise.subscribe(handleResolve, handleReject);
    if (!unsubscribe) {
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (signal.aborted) {
      unsubscribe();
      reject(signal.reason);
      return;
    }
    listener = () => {
      signal.removeEventListener("abort", listener!);
      unsubscribe();
      reject(signal.reason);
    };
    signal.addEventListener("abort", listener);
  });
