import type {
  InnerSubscriber,
  InnerSubscription,
  Producer,
} from "./lazyPromise";
import { LazyPromise } from "./lazyPromise";

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
 */
export const inIdleCallback = (
  options?: IdleRequestOptions,
): LazyPromise<IdleDeadline> =>
  new LazyPromise(new InIdleCallbackProducer(options));
