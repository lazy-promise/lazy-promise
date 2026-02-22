import { LazyPromise, TypedError } from "./lazyPromise";

const emptySymbol = Symbol("empty");

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
      let dispose: (() => void) | undefined | typeof emptySymbol = emptySymbol;
      dispose = source.subscribe(
        (value) => {
          let callbackResult;
          try {
            callbackResult = callback();
          } catch (callbackError) {
            if (dispose) {
              reject(callbackError);
            }
            return;
          }
          if (!dispose) {
            return;
          }
          if (callbackResult instanceof LazyPromise) {
            resolve(
              new LazyPromise((resolve, reject) =>
                callbackResult.subscribe((innerValue) => {
                  resolve(
                    innerValue instanceof TypedError ? innerValue : value,
                  );
                }, reject),
              ),
            );
            return;
          }
          resolve(
            callbackResult instanceof TypedError ? callbackResult : value,
          );
        },
        (error) => {
          let callbackResult;
          try {
            callbackResult = callback();
          } catch (callbackError) {
            if (dispose) {
              reject(callbackError);
            }
            return;
          }
          if (!dispose) {
            return;
          }
          if (callbackResult instanceof LazyPromise) {
            resolve(
              new LazyPromise((resolve, reject) =>
                callbackResult.subscribe((innerValue) => {
                  if (innerValue instanceof TypedError) {
                    resolve(innerValue);
                    return;
                  }
                  reject(error);
                }, reject),
              ),
            );
            return;
          }
          reject(error);
        },
      );
      if (dispose) {
        return () => {
          (dispose as () => void)();
          // If the promise was unsubscribed from the callback, discard the
          // callback's return value or error.
          dispose = undefined;
        };
      }
    });
