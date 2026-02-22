import { LazyPromise, TypedError } from "./lazyPromise";

const emptySymbol = Symbol("empty");

/**
 * The LazyPromise equivalent of `promise.catch(...)` for typed errors.
 */
export const catchTypedError =
  <Value, NewValue>(
    callback: (
      error: Value extends TypedError<infer Error> ? Error : never,
    ) => NewValue | LazyPromise<NewValue>,
  ) =>
  (
    source: LazyPromise<Value>,
  ): LazyPromise<NewValue | (Value extends TypedError<any> ? never : Value)> =>
    new LazyPromise<any>((resolve, reject) => {
      let dispose: (() => void) | undefined | typeof emptySymbol = emptySymbol;
      dispose = source.subscribe((value) => {
        if (value instanceof TypedError) {
          let newValue;
          try {
            newValue = callback(value.error);
          } catch (callbackError) {
            if (dispose) {
              reject(callbackError);
            }
            return;
          }
          if (dispose) {
            resolve(newValue);
          }
          return;
        }
        resolve(value);
      }, reject);
      if (dispose) {
        return () => {
          (dispose as () => void)();
          // If the promise was unsubscribed from the callback, discard the
          // callback's return value or error.
          dispose = undefined;
        };
      }
    });
