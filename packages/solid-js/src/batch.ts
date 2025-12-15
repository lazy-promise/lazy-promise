import type { LazyPromise } from "@lazy-promise/core";
import { createLazyPromise } from "@lazy-promise/core";
import { batch } from "solid-js";

/**
 * Wraps the value handler in a Solid `batch`. E.g.
 *
 * ```
 * const [processing, trackProcessing] = createTrackProcessing();
 * useLazyPromise(
 *   pipe(
 *     lazyPromise,
 *     batchValue,
 *     trackProcessing,
 *     map(...),
 *   ),
 * )
 * ```
 *
 * Here when the promise resolves, `processing` will be updated in a batch
 * together with any signals that `map(...)` updates.
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
 * useLazyPromise(
 *   pipe(
 *     lazyPromise,
 *     batchError,
 *     trackProcessing,
 *     catchError(...),
 *   ),
 * )
 * ```
 *
 * Here when the promise rejects, `processing` will be updated in a batch
 * together with any signals that `catchError(...)` updates.
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
