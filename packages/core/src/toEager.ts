import type { LazyPromise } from "./lazyPromise";
import { noopUnsubscribe } from "./lazyPromise";

const wrapRejectionError = (error: unknown) =>
  new Error(
    `The lazy promise passed to toEager(...) has rejected. The original error has been stored as the .cause property.`,
    { cause: error },
  );

/**
 * Converts a LazyPromise to a Promise. The LazyPromise is expected to not
 * reject, and failures are passed on as Promise rejections. If you'd like
 * LazyPromise rejections to also be passed on as Promise rejections, pipe the
 * lazy promise through `catchRejection(failed)`.
 *
 * You can pass an AbortSignal in the options object.
 */
export const toEager = <Value>(
  lazyPromise: LazyPromise<Value, never>,
  options?: { readonly signal?: AbortSignal },
): Promise<Value> =>
  new Promise((resolve, reject) => {
    const signal = options?.signal;
    if (!signal) {
      lazyPromise.subscribe(
        resolve,
        (error) => {
          reject(wrapRejectionError(error));
        },
        reject,
      );
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
      reject(wrapRejectionError(error));
    };
    const handleFailure = (error: unknown) => {
      if (listener) {
        signal.removeEventListener("abort", listener);
      }
      reject(error);
    };
    const unsubscribe = lazyPromise.subscribe(
      handleResolve,
      handleReject,
      handleFailure,
    );
    if (unsubscribe === noopUnsubscribe) {
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
