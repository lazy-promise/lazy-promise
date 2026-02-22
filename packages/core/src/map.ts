import { LazyPromise, TypedError } from "./lazyPromise";

const emptySymbol = Symbol("empty");

/**
 * The LazyPromise equivalent of `promise.then(...)`.
 */
export const map =
  <Value, NewValue>(
    callback: (
      value: Value extends TypedError<any> ? never : Value,
    ) => NewValue | LazyPromise<NewValue>,
  ) =>
  (
    source: LazyPromise<Value>,
  ): LazyPromise<
    | NewValue
    | (Value extends TypedError<infer Error> ? TypedError<Error> : never)
  > =>
    new LazyPromise<any>((resolve, reject) => {
      let dispose: (() => void) | undefined | typeof emptySymbol = emptySymbol;
      dispose = source.subscribe((value) => {
        if (value instanceof TypedError) {
          resolve(value);
          return;
        }
        let newValue;
        try {
          newValue = callback(value as any);
        } catch (callbackError) {
          if (dispose) {
            reject(callbackError);
          }
          return;
        }
        if (dispose) {
          resolve(newValue);
        }
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
