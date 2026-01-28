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
      let dispose: (() => void) | undefined;
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
            dispose = valueOrPromise.subscribe(
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
      const disposeOuter = source.subscribe(
        handleSettle(resolve),
        handleSettle(reject as any),
        handleSettle(fail),
      );
      if (!dispose) {
        dispose = disposeOuter;
      }
      return () => {
        disposed = true;
        dispose!();
      };
    });
