import type { LazyPromise } from "@lazy-promise/core";
import { createLazyPromise } from "@lazy-promise/core";
import { batch } from "solid-js";

/**
 * Wraps the value handler in a Solid `batch`.
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
 * Wraps the error handler in a Solid `batch`.
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
