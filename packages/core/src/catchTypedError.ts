import { LazyPromise, TypedError } from "./lazyPromise";

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
      let unsubscribe: (() => void) | undefined;
      let disposed = false;
      const unsubscribeOuter = source.subscribe((value) => {
        if (value instanceof TypedError) {
          let newValueOrPromise;
          try {
            newValueOrPromise = callback(value.error);
          } catch (error) {
            if (disposed) {
              throw error;
            }
            reject(error);
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
          return;
        }
        resolve(value);
      }, reject);
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
