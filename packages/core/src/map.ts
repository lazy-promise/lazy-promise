import type { LazyPromise } from "./lazyPromise";
import { createLazyPromise, isLazyPromise } from "./lazyPromise";

/**
 * The LazyPromise equivalent of promise.catch(...). To make the resulting
 * promise reject, return `rejected(yourError)`.
 */
export const map =
  <Value, NewValue, NewError = never>(
    callback: (value: Value) => NewValue | LazyPromise<NewValue, NewError>,
  ) =>
  <Error>(
    source: LazyPromise<Value, Error>,
  ): LazyPromise<NewValue, Error | NewError> =>
    createLazyPromise((resolve, reject) => {
      let dispose: (() => void) | undefined;
      const disposeOuter = source.subscribe((value) => {
        const newValueOrPromise = callback(value);
        if (isLazyPromise(newValueOrPromise)) {
          dispose = newValueOrPromise.subscribe(resolve, reject);
        } else {
          resolve(newValueOrPromise);
        }
      }, reject);
      if (!dispose) {
        dispose = disposeOuter;
      }
      return () => {
        dispose!();
      };
    });
