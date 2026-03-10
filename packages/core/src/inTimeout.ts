import type {
  InnerSubscriber,
  InnerSubscription,
  Producer,
} from "./lazyPromise";
import { LazyPromise } from "./lazyPromise";

class InTimeoutSubscription implements InnerSubscription {
  constructor(public id: ReturnType<typeof setTimeout>) {}

  unsubscribe() {
    clearTimeout(this.id);
  }
}

const callback = (innerSubscriber: InnerSubscriber<void>) => {
  innerSubscriber.resolve();
};

class InTimeoutProducer implements Producer<void> {
  constructor(public ms?: number) {}

  produce(innerSubscriber: InnerSubscriber<void>) {
    return new InTimeoutSubscription(
      setTimeout(callback, this.ms, innerSubscriber),
    );
  }
}

/**
 * Takes optional duration in ms, and returns a lazy promise that resolves with
 * a value of type `void` when setTimeout fires.
 *
 * To make a lazy promise settle with a delay, pipe it though
 *
 * ```
 * finalize(() => inTimeout(ms))
 * ```
 *
 * To delay a promise only when it resolves, use
 *
 * ```
 * map((value) => inTimeout(ms).pipe(map(() => value)))
 * ```
 */
export const inTimeout = (ms?: number): LazyPromise<void> =>
  new LazyPromise(new InTimeoutProducer(ms));
