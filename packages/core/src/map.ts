import { LazyPromise } from "./lazyPromise";

/**
 * The LazyPromise equivalent of `promise.then(...)`. To make the resulting
 * promise reject, return `rejected(yourError)`.
 */
export const map =
  <Value, NewValue, NewError = never>(
    callback: (value: Value) => NewValue | LazyPromise<NewValue, NewError>,
  ) =>
  <Error>(
    source: LazyPromise<Value, Error>,
  ): LazyPromise<NewValue, Error | NewError> =>
    new LazyPromise(
      (resolve: ((value: NewValue) => void) | undefined, reject, fail) => {
        let dispose: (() => void) | undefined;
        const disposeOuter = source.subscribe(
          (value) => {
            let newValueOrPromise;
            try {
              newValueOrPromise = callback(value);
            } catch (error) {
              if (!resolve) {
                throw error;
              }
              fail(error);
              return;
            }
            if (!resolve) {
              return;
            }
            if (newValueOrPromise instanceof LazyPromise) {
              dispose = newValueOrPromise.subscribe(resolve, reject, fail);
            } else {
              resolve(newValueOrPromise);
            }
          },
          reject,
          fail,
        );
        if (!dispose) {
          dispose = disposeOuter;
        }
        return () => {
          resolve = undefined;
          dispose!();
        };
      },
    );
