import type { LazyPromise } from "./lazyPromise";
import { createLazyPromise, isLazyPromise } from "./lazyPromise";

/**
 * The LazyPromise equivalent of `promise.catch(...)`. To make the resulting
 * promise reject, return `rejected(yourError)`.
 */
export const catchRejection =
  <Error, NewValue, NewError = never>(
    callback: (error: Error) => NewValue | LazyPromise<NewValue, NewError>,
  ) =>
  <Value>(
    source: LazyPromise<Value, Error>,
  ): LazyPromise<Value | NewValue, NewError> =>
    createLazyPromise((resolve, reject, fail) => {
      let dispose: (() => void) | undefined;
      const disposeOuter = source.subscribe(
        resolve,
        (error) => {
          let newValueOrPromise;
          try {
            newValueOrPromise = callback(error);
          } catch (newError) {
            fail(newError);
            return;
          }
          if (isLazyPromise(newValueOrPromise)) {
            dispose = newValueOrPromise.subscribe(resolve, reject, fail);
          } else {
            resolve(newValueOrPromise);
          }
        },
        fail,
      );
      if (!dispose) {
        dispose = disposeOuter;
      }
      return () => {
        dispose!();
      };
    });
