import type {
  InnerSubscriber,
  InnerSubscription,
  Producer,
} from "./lazyPromise";
import { LazyPromise } from "./lazyPromise";

class InImmediateSubscription implements InnerSubscription {
  constructor(public id: ReturnType<typeof setImmediate>) {}

  unsubscribe() {
    clearImmediate(this.id);
  }
}

const callback = (innerSubscriber: InnerSubscriber<void>) => {
  innerSubscriber.resolve();
};

class InImmediateProducer implements Producer<void> {
  produce(innerSubscriber: InnerSubscriber<void>) {
    return new InImmediateSubscription(setImmediate(callback, innerSubscriber));
  }
}

/**
 * Returns a lazy promise that resolves with a value of type `void` in a
 * setImmediate callback (deprecated outside of Node).
 *
 * To defer execution of a callback, use
 *
 * ```
 * inImmediate().pipe(map(() => ...))
 * ```
 *
 * To make an existing lazy promise settle via setImmediate, pipe it though
 *
 * ```
 * finalize(inImmediate)
 * ```
 *
 * To limit this to only when the promise resolves, use
 *
 * ```
 * map((value) => inImmediate().pipe(map(() => value)))
 * ```
 */
export const inImmediate = (): LazyPromise<void> =>
  new LazyPromise(new InImmediateProducer());
