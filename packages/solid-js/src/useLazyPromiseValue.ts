import type { LazyPromise } from "@lazy-promise/core";
import { noopUnsubscribe } from "@lazy-promise/core";
import type { Accessor } from "solid-js";
import {
  createMemo,
  createSignal,
  getOwner,
  onCleanup,
  runWithOwner,
} from "solid-js";

export const loadingSymbol = Symbol("loading");

/**
 * Takes an accessor returning a lazy promise, and turns it into a signal. When
 * an accessor's dependency changes, we're unsubscribing from the previous lazy
 * promise and subscribing to the new one.
 *
 * ```
 * const data = useLazyPromiseValue(() => lazyPromise);
 * ```
 *
 * Above, `data` is an accessor that initially returns a Symbol `loadingSymbol`,
 * and once the lazy promise resolves, the value it has resolved to.
 *
 * The error type of the lazy promise must be `never`. To error out the scope,
 * fail the lazy promise.
 */
export const useLazyPromiseValue = <Value>(
  lazyPromiseAccessor: Accessor<LazyPromise<Value, never>>,
): Accessor<Value | typeof loadingSymbol> => {
  let value: Value | typeof loadingSymbol;

  // Used to trigger return value change when the promise resolves asynchronously.
  const [resolvedSymbol, setResolvedSymbol] = createSignal();

  const lazyPromiseMemo = createMemo(() => {
    value = loadingSymbol;
    return lazyPromiseAccessor();
  });

  return createMemo<Value | typeof loadingSymbol>(() => {
    const lazyPromise = lazyPromiseMemo();
    // If we're reacting to a change in resolvedSymbol.
    if (value !== loadingSymbol) {
      return value;
    }
    const owner = getOwner();
    let unsubscribe: (() => void) | undefined = undefined;
    unsubscribe = runWithOwner(null, () =>
      lazyPromise.subscribe(
        (valueLocal) => {
          value = valueLocal;
          if (unsubscribe) {
            setResolvedSymbol(Symbol());
          }
        },
        undefined,
        (error) => {
          runWithOwner(owner, () => {
            throw error;
          });
        },
      ),
    );
    if (unsubscribe && unsubscribe !== noopUnsubscribe) {
      // Create dependency.
      resolvedSymbol();
      onCleanup(unsubscribe);
    }
    return value;
  });
};
