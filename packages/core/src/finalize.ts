import { LazyPromise } from "./lazyPromise";

/**
 * The LazyPromise equivalent of `promise.finally(...)`. The callback is called
 * if the source promise resolves, rejects, or fails.
 */
export const finalize =
  <CallbackReturn>(callback: () => CallbackReturn) =>
  <Value, Error>(
    source: LazyPromise<Value, Error>,
  ): LazyPromise<
    Value,
    CallbackReturn extends LazyPromise<any, infer NewError>
      ? Error | NewError
      : Error
  > =>
    new LazyPromise((resolve, reject, fail) => {
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
            fail(error);
            return;
          }
          if (disposed) {
            return;
          }
          if (valueOrPromise instanceof LazyPromise) {
            unsubscribe = valueOrPromise.subscribe(
              () => {
                settle(arg);
              },
              reject,
              fail,
            );
          } else {
            settle(arg);
          }
        };
      const unsubscribeOuter = source.subscribe(
        handleSettle(resolve),
        handleSettle(reject as any),
        handleSettle(fail),
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
