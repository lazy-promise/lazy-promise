import type { LazyPromise } from "./lazyPromise";
import { createLazyPromise, isLazyPromise } from "./lazyPromise";

/**
 * The LazyPromise equivalent of promise.catch(...). To make the resulting
 * promise reject, return `rejected(yourError)`.
 */
export const catchError =
  <Error, NewValue, NewError = never>(
    callback: (error: Error) => NewValue | LazyPromise<NewValue, NewError>,
  ) =>
  <Value>(
    source: LazyPromise<Value, Error>,
  ): LazyPromise<Value | NewValue, NewError> =>
    createLazyPromise((resolve, reject) => {
      let dispose: (() => void) | undefined;
      const disposeOuter = source.subscribe(resolve, (error) => {
        const newValueOrPromise = callback(error);
        if (isLazyPromise(newValueOrPromise)) {
          dispose = newValueOrPromise.subscribe(resolve, reject);
        } else {
          resolve(newValueOrPromise);
        }
      });
      if (!dispose) {
        dispose = disposeOuter;
      }
      return () => {
        dispose!();
      };
    });
