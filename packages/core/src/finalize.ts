import { LazyPromise, TypedError } from "./lazyPromise";

/**
 * The LazyPromise equivalent of `promise.finally(...)`. The callback is called
 * if the source promise resolves or rejects, but not if it's unsubscribed
 * before settling.
 */
export const finalize =
  <NewValue>(callback: () => NewValue | LazyPromise<NewValue>) =>
  <Value>(
    source: LazyPromise<Value>,
  ): LazyPromise<
    | Value
    | (NewValue extends TypedError<infer Error> ? TypedError<Error> : never)
  > =>
    new LazyPromise<any>((resolve, reject) => {
      let disposed = false;
      let unsubscribe: (() => void) | undefined;
      const handleSettle =
        <Arg>(settle: (arg: Arg) => void) =>
        (arg: Arg) => {
          let valueOrPromise;
          try {
            valueOrPromise = callback();
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
          if (valueOrPromise instanceof LazyPromise) {
            unsubscribe = valueOrPromise.subscribe((value) => {
              if (value instanceof TypedError) {
                resolve(value);
                return;
              }
              settle(arg);
            }, reject);
            return;
          }
          if (valueOrPromise instanceof TypedError) {
            resolve(valueOrPromise);
            return;
          }
          settle(arg);
        };
      const unsubscribeOuter = source.subscribe(
        handleSettle(resolve),
        handleSettle(reject),
      );
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
