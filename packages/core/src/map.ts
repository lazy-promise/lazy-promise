import { LazyPromise, TypedError } from "./lazyPromise";

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
      let unsubscribe: (() => void) | undefined;
      let disposed = false;
      const unsubscribeOuter = source.subscribe((value) => {
        if (value instanceof TypedError) {
          resolve(value);
          return;
        }
        let newValueOrPromise;
        try {
          newValueOrPromise = callback(value as any);
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
