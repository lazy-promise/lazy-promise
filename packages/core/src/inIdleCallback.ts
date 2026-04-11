import type {
  InnerSubscriber,
  InnerSubscription,
  Producer,
} from "./lazyPromise.js";
import { LazyPromise } from "./lazyPromise.js";

class InIdleCallbackSubscription implements InnerSubscription {
  constructor(public id: ReturnType<typeof requestIdleCallback>) {}

  unsubscribe() {
    cancelIdleCallback(this.id);
  }
}

class InIdleCallbackProducer implements Producer<IdleDeadline> {
  constructor(public options?: IdleRequestOptions) {}

  produce(innerSubscriber: InnerSubscriber<IdleDeadline>) {
    return new InIdleCallbackSubscription(
      requestIdleCallback((idleDeadline) => {
        innerSubscriber.resolve(idleDeadline);
      }, this.options),
    );
  }
}

/**
 * Takes optional IdleRequestOptions, and returns a lazy promise that resolves
 * with `IdleDeadline` in an idle callback.
 *
 * To defer execution of a callback, use
 *
 * ```
 * inIdleCallback().map(() => ...)
 * ```
 *
 * To make an existing lazy promise settle in an idle callback, pipe it though
 *
 * ```
 * .finalize(inIdleCallback)
 * ```
 *
 * To limit this to only when the promise resolves, use
 *
 * ```
 * map((value) => inIdleCallback().map(() => value))
 * ```
 */
export const inIdleCallback = (
  options?: IdleRequestOptions,
): LazyPromise<IdleDeadline> =>
  new LazyPromise(new InIdleCallbackProducer(options));
