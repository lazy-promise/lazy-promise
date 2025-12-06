import type { LazyPromise } from "@lazy-promise/core";
import { createLazyPromise } from "@lazy-promise/core";
import { batch } from "solid-js";

/**
 * Wraps the value handler in a Solid `batch`. E.g.
 *
 * ```
 * const [processing, trackProcessing] = createTrackProcessing();
 * const wrappedLazyPromise = pipe(
 *   lazyPromise,
 *   batchValue,
 *   trackProcessing,
 *   useLazyPromise(handleValue);
 * );
 * ```
 *
 * Here `processing` will be updated in a batch together with any signals that
 * handleValue updates.
 */
export const batchValue = <Value, Error>(
  source: LazyPromise<Value, Error>,
): LazyPromise<Value, Error> =>
  createLazyPromise<any, any>((resolve, reject, fail) =>
    source.subscribe(
      (value) => {
        batch(() => {
          resolve(value);
        });
      },
      reject,
      fail,
    ),
  );

/**
 * Wraps the error handler in a Solid `batch`. E.g.
 *
 * ```
 * const [processing, trackProcessing] = createTrackProcessing();
 * const wrappedLazyPromise = pipe(
 *   lazyPromise,
 *   batchError,
 *   trackProcessing,
 *   useLazyPromise(handleValue);
 * );
 * ```
 *
 * Here `processing` will be updated in a batch together with any signals that
 * batchError updates.
 */
export const batchError = <Value, Error>(
  source: LazyPromise<Value, Error>,
): LazyPromise<Value, Error> =>
  createLazyPromise<any, any>((resolve, reject, fail) =>
    source.subscribe(
      resolve,
      (error) => {
        batch(() => {
          reject(error);
        });
      },
      fail,
    ),
  );
