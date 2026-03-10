import { finalize, LazyPromise } from "@lazy-promise/core";
import type { Accessor } from "solid-js";
import { createMemo, createSignal } from "solid-js";

export type TrackProcessing = <Value>(
  lazyPromise: LazyPromise<Value>,
) => LazyPromise<Value>;

/**
 * A utility useful for things like loading indicators. Returns a tuple
 * `[processing, trackProcessing]`. `trackProcessing` is an operator that you
 * can apply to one or more lazy promises:
 *
 * ```
 * const [processing, trackProcessing] = createTrackProcessing();
 * const wrappedLazyPromise = lazyPromise.pipe(trackProcessing);
 * ```
 *
 * `processing` is an accessor that will tell you whether any of the wrapped
 * promises are currently active, i.e. subscribed but not yet settled or
 * unsubscribed.
 */
export const createTrackProcessing = (): [
  Accessor<boolean>,
  TrackProcessing,
] => {
  const [count, setCount] = createSignal(0);
  const processing = createMemo(() => count() > 0);
  return [
    processing,
    <Value>(lazyPromise: LazyPromise<Value>) =>
      new LazyPromise<Value>((subscriber) => {
        setCount((count) => count + 1);
        const subscription = lazyPromise
          .pipe(
            finalize(() => {
              setCount((count) => count - 1);
            }),
          )
          .subscribe(subscriber);
        return () => {
          setCount((count) => count - 1);
          subscription.unsubscribe();
        };
      }),
  ];
};
