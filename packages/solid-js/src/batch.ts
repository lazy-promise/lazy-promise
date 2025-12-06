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
 * Here when the promise resolves, `processing` will be updated in a batch
 * together with any signals that handleValue updates.
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
 *   useLazyPromise(undefined, handleError);
 * );
 * ```
 *
 * Here when the promise errors, `processing` will be updated in a batch
 * together with any signals that handleError updates.
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
