import type { LazyPromise } from "@lazy-promise/core";
import {
  createLazyPromise,
  finalize,
  noopUnsubscribe,
} from "@lazy-promise/core";
import { pipe } from "pipe-function";
import type { Accessor } from "solid-js";
import { createMemo, createSignal } from "solid-js";

export type TrackProcessing = <Value, Error>(
  lazyPromise: LazyPromise<Value, Error>,
) => LazyPromise<Value, Error>;

/**
 * A utility useful for things like loading indicators. Returns a tuple
 * `[processing, trackProcessing]`. `trackProcessing` is an operator that you
 * can apply to one or more lazy promises:
 *
 * ```
 * const [processing, trackProcessing] = createTrackProcessing();
 * const wrappedLazyPromise = pipe(lazyPromise, trackProcessing);
 * ```
 *
 * `processing` is an accessor that will tell you whether any of the wrapped
 * promises are currently active, i.e. subscribed but not yet settled or
 * unsubscribed. It only changes its value to `true` when a lazy promise doesn't
 * settle synchronously.
 */
export const createTrackProcessing = (): [
  Accessor<boolean>,
  TrackProcessing,
] => {
  const [count, setCount] = createSignal(0);
  const processing = createMemo(() => count() > 0);
  return [
    processing,
    <Value, Error>(lazyPromise: LazyPromise<Value, Error>) =>
      createLazyPromise<Value, Error>((resolve, reject, fail) => {
        let unsubscribe: (() => void) | undefined;
        // eslint-disable-next-line prefer-const
        unsubscribe = pipe(
          lazyPromise,
          finalize(() => {
            if (unsubscribe) {
              setCount((count) => count - 1);
            }
          }),
        ).subscribe(resolve, reject, fail);
        if (unsubscribe === noopUnsubscribe) {
          return;
        }
        setCount((count) => count + 1);
        return () => {
          setCount((count) => count - 1);
          unsubscribe();
        };
      }),
  ];
};
