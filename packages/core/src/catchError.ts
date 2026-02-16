import { LazyPromise } from "./lazyPromise";

/**
 * The LazyPromise equivalent of `promise.catch(...)`.
 */
export const catchError =
  <NewValue>(callback: (error: unknown) => NewValue | LazyPromise<NewValue>) =>
  <Value>(source: LazyPromise<Value>): LazyPromise<Value | NewValue> =>
    new LazyPromise((resolve, reject) => {
      let unsubscribe: (() => void) | undefined;
      let disposed = false;
      const unsubscribeOuter = source.subscribe(resolve, (error) => {
        let newValueOrPromise: NewValue | LazyPromise<NewValue>;
        try {
          newValueOrPromise = callback(error);
        } catch (callbackError) {
          if (disposed) {
            throw callbackError;
          }
          reject(callbackError);
          return;
        }
        if (disposed) {
          return;
        }
        if (newValueOrPromise instanceof LazyPromise) {
          unsubscribe = newValueOrPromise.subscribe(resolve, reject);
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
        disposed = true;
        unsubscribe!();
      };
    });
