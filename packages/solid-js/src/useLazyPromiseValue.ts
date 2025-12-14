import type { LazyPromise } from "@lazy-promise/core";
import type { Accessor } from "solid-js";
import { createMemo, createSignal } from "solid-js";
import { useLazyPromise } from "./useLazyPromise";

export const loadingSymbol = Symbol("loading");
export const errorSymbol = Symbol("error");

/**
 * Takes an accessor returning a lazy promise, and turns it into a signal. The
 * accessor's dependencies are tracked, and as soon as the return value changes,
 * we're unsubscribing from the previous lazy promise and subscribing to the new
 * one.
 *
 * All other callbacks, whether they're run synchronously or asynchronously, are
 * run outside of the scope (which among other things means no tracking).
 *
 * ```
 * const data = useLazyPromiseValue(lazyPromiseAccessor, handleError);
 * ```
 *
 * Above, `data` is an accessor that initially returns a Symbol `loadingSymbol`,
 * and once the lazy promise resolves, the value it has resolved to. If the
 * error type of your lazy promise is other than `never`, the type system will
 * want you to provide an error handler, and `data` will have another possible
 * value `errorSymbol`.
 */
export const useLazyPromiseValue: <Value, Error>(
  lazyPromiseAccessor: Accessor<LazyPromise<Value, Error>>,
  ...args: [Error] extends [never]
    ? [handleError?: ((error: Error) => void) | undefined]
    : [handleError: (error: Error) => void]
) => Accessor<
  | Value
  | typeof loadingSymbol
  | (Error extends never ? never : typeof errorSymbol)
> = <Value, Error>(
  lazyPromiseAccessor: Accessor<LazyPromise<Value, Error>>,
  handleError?: (error: Error) => void,
) => {
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
    useLazyPromise<any, any>(
      lazyPromise,
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
    );
    sync = false;
    if (value === loadingSymbol) {
      resolvedSymbol();
    }
    return value;
  });

  return result as any;
};
