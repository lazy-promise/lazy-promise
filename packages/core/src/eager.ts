import type { LazyPromise } from "./lazyPromise";
import { noopUnsubscribe } from "./lazyPromise";

/**
 * Converts a LazyPromise to a Promise.
 */
export const eager = <Value>(
  lazyPromise: LazyPromise<Value, unknown>,
  abortSignal?: AbortSignal,
): Promise<Value> =>
  new Promise((resolve, reject) => {
    if (!abortSignal) {
      lazyPromise.subscribe(resolve, reject, reject);
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
    const handleRejectOrFailure = (error: unknown) => {
      if (listener) {
        abortSignal.removeEventListener("abort", listener);
      }
      reject(error);
    };
    const unsubscribe = lazyPromise.subscribe(
      handleResolve,
      handleRejectOrFailure,
      handleRejectOrFailure,
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
