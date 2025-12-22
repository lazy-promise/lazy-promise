import type { LazyPromise } from "@lazy-promise/core";
import { noopUnsubscribe } from "@lazy-promise/core";
import type { ResourceFetcher, ResourceFetcherInfo } from "solid-js";
import { onCleanup, runWithOwner } from "solid-js";

export const createFetcher =
  <S, T, R = unknown>(
    callback: (k: S, info: ResourceFetcherInfo<T, R>) => LazyPromise<T, never>,
  ): ResourceFetcher<S, T, R> =>
  (k: S, info: ResourceFetcherInfo<T, R>): T | Promise<T> => {
    const lazyPromise = callback(k, info);
    let errored = false;
    let result: unknown;
    let resolve: ((value: T) => void) | undefined;
    let reject: ((error: unknown) => void) | undefined;
    const unsubscribe = runWithOwner(null, () =>
      lazyPromise.subscribe(
        (value) => {
          if (resolve) {
            resolve(value);
            return;
          }
          result = value;
        },
        undefined,
        (error) => {
          if (reject) {
            reject(error);
            return;
          }
          result = error;
          errored = true;
        },
      ),
    )!;
    if (unsubscribe === noopUnsubscribe) {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (errored) {
        throw result;
      }
      return result as T;
    }
    onCleanup(unsubscribe);
    return new Promise((resolveLocal, rejectLocal) => {
      resolve = resolveLocal;
      reject = rejectLocal;
    });
  };
