import { LazyPromise } from "./lazyPromise";

/**
 * Lets you recover from a failure of the source promise. To make the resulting
 * promise reject, return `rejected(yourError)`.
 */
export const catchFailure =
  <Error, NewValue, NewError = never>(
    callback: (error: unknown) => NewValue | LazyPromise<NewValue, NewError>,
  ) =>
  <Value>(
    source: LazyPromise<Value, Error>,
  ): LazyPromise<Value | NewValue, Error | NewError> =>
    new LazyPromise(
      (
        resolve: ((value: NewValue | Value) => void) | undefined,
        reject,
        fail,
      ) => {
        let unsubscribe: (() => void) | undefined;
        const unsubscribeOuter = source.subscribe(resolve, reject, (error) => {
          let newValueOrPromise: NewValue | LazyPromise<NewValue, NewError>;
          try {
            newValueOrPromise = callback(error);
          } catch (callbackError) {
            if (!resolve) {
              throw callbackError;
            }
            fail(callbackError);
            return;
          }
          if (!resolve) {
            return;
          }
          if (newValueOrPromise instanceof LazyPromise) {
            unsubscribe = newValueOrPromise.subscribe(resolve, reject, fail);
          } else {
            resolve(newValueOrPromise);
          }
        });
        if (!unsubscribe) {
          if (unsubscribeOuter) {
            unsubscribe = unsubscribeOuter;
          } else {
            return;
          }
        }
        return () => {
          resolve = undefined;
          unsubscribe!();
        };
      },
    );
