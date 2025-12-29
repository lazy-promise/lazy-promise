import type { LazyPromise } from "./lazyPromise";
import { noopUnsubscribe } from "./lazyPromise";

const wrapRejectionError = (error: unknown) =>
  new Error(
    `The lazy promise passed to eager(...) has rejected. The original error has been stored as the .cause property.`,
    { cause: error },
  );

/**
 * Converts a LazyPromise to a Promise. The LazyPromise is expected to not
 * reject, and failures are passed on as Promise rejections. If you'd like
 * LazyPromise rejections to also be passed on as Promise rejections, pipe the
 * LazyPromise through `catchRejection(failed)`.
 */
export const eager = <Value>(
  lazyPromise: LazyPromise<Value, never>,
  abortSignal?: AbortSignal,
): Promise<Value> =>
  new Promise((resolve, reject) => {
    if (!abortSignal) {
      lazyPromise.subscribe(
        resolve,
        (error) => {
          reject(wrapRejectionError(error));
        },
        reject,
      );
      return;
    }
    if (abortSignal.aborted) {
      reject(abortSignal.reason);
      return;
    }
    let listener: (() => void) | undefined = undefined;
    const handleResolve = (value: Value) => {
      if (listener) {
        abortSignal.removeEventListener("abort", listener);
      }
      resolve(value);
    };
    const handleReject = (error: unknown) => {
      if (listener) {
        abortSignal.removeEventListener("abort", listener);
      }
      reject(wrapRejectionError(error));
    };
    const handleFailure = (error: unknown) => {
      if (listener) {
        abortSignal.removeEventListener("abort", listener);
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
    if (abortSignal.aborted) {
      unsubscribe();
      reject(abortSignal.reason);
      return;
    }
    listener = () => {
      abortSignal.removeEventListener("abort", listener!);
      unsubscribe();
      reject(abortSignal.reason);
    };
    abortSignal.addEventListener("abort", listener);
  });
