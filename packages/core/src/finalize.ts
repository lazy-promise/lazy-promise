import { LazyPromise } from "./lazyPromise";

const wrapRejectionError = (error: unknown) =>
  new Error(
    `The lazy promise returned by finalize(...) callback has rejected. The original error has been stored as the .cause property.`,
    { cause: error },
  );

/**
 * The LazyPromise equivalent of `promise.finally(...)`. The callback is called
 * if the source promise resolves, rejects, or fails. If the callback returns
 * a lazy promise, that promise is expected to never reject.
 */
export const finalize =
  <CallbackReturn>(
    callback: () => CallbackReturn extends LazyPromise<unknown, unknown>
      ? LazyPromise<unknown, never>
      : CallbackReturn,
  ) =>
  <Value, Error>(
    source: LazyPromise<Value, Error>,
  ): LazyPromise<Value, Error> =>
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
              (error) => {
                fail(wrapRejectionError(error));
              },
              fail,
            );
          } else {
            settle(arg);
          }
        };
      const disposeOuter = source.subscribe(
        handleSettle(resolve),
        handleSettle(reject),
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
