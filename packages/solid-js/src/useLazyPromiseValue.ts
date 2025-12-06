import type { LazyPromise } from "@lazy-promise/core";
import { pipe } from "pipe-function";
import type { Accessor } from "solid-js";
import { createMemo, createSignal } from "solid-js";
import { useLazyPromise } from "./useLazyPromise";

export const loadingSymbol = Symbol("loading");
export const errorSymbol = Symbol("error");

/**
 * Takes an accessor that returns a lazy promise, and turns it into a signal.
 *
 * All callbacks except for the passed-in accessor, whether they're run
 * synchronously or asynchronously, are run outside of the scope (which among
 * other things means no tracking).
 *
 * ```
 * const data = useLazyPromiseValue(() => getLazyPromise(mySignal()));
 * ```
 *
 * Before the promise resolves, the `data` accessor returns `loadingSymbol`. If
 * the error type of your lazy promise is other than `never`, the type system
 * will want you to provide an error handler, and `data` will have another
 * possible value `errorSymbol`.
 */
export const useLazyPromiseValue = <Value, Error>(
  lazyPromiseAccessor: Accessor<LazyPromise<Value, Error>>,
  handleError?: (error: Error) => void,
  handleFailure?: () => void,
): Accessor<
  | Value
  | typeof loadingSymbol
  | (Error extends never ? never : typeof errorSymbol)
> => {
  let value: Value | typeof loadingSymbol | typeof errorSymbol;

  const lazyPromiseMemo = createMemo<LazyPromise<Value, Error>>((prev) => {
    const lazyPromise = lazyPromiseAccessor();
    if (lazyPromise !== prev) {
      value = loadingSymbol;
    }
    return lazyPromise;
  });

  // Used to trigger return value change when the promise resolves asynchronously.
  const [resolvedSymbol, setResolvedSymbol] = createSignal();

  const result = createMemo(() => {
    const lazyPromise = lazyPromiseMemo();
    if (value !== loadingSymbol) {
      return value;
    }
    let sync = true;
    pipe(
      lazyPromise,
      useLazyPromise<any, any>(
        (newValue) => {
          value = newValue;
          if (!sync) {
            setResolvedSymbol(Symbol());
          }
        },
        (error) => {
          value = errorSymbol;
          if (!sync) {
            setResolvedSymbol(Symbol());
          }
          handleError?.(error);
        },
        handleFailure,
      ),
    );
    sync = false;
    if (value === loadingSymbol) {
      resolvedSymbol();
    }
    return value;
  });

  return result as any;
};
