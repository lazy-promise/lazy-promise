import { LazyPromise } from "./lazyPromise";

const emptySymbol = Symbol("empty");

/**
 * The LazyPromise equivalent of `promise.catch(...)`.
 */
export const catchError =
  <NewValue>(callback: (error: unknown) => NewValue | LazyPromise<NewValue>) =>
  <Value>(source: LazyPromise<Value>): LazyPromise<Value | NewValue> =>
    new LazyPromise((resolve, reject) => {
      let dispose: (() => void) | undefined | typeof emptySymbol = emptySymbol;
      dispose = source.subscribe(resolve, (error) => {
        let newValue;
        try {
          newValue = callback(error);
        } catch (callbackError) {
          if (dispose) {
            reject(callbackError);
          }
          return;
        }
        if (dispose) {
          resolve(newValue);
        }
      });
      if (dispose) {
        return () => {
          (dispose as () => void)();
          // If the promise was unsubscribed from the callback, discard the
          // callback's return value or error.
          dispose = undefined;
        };
      }
    });
