import type {
  InnerSubscriber,
  InnerSubscription,
  Producer,
} from "./lazyPromise.js";
import { LazyPromise } from "./lazyPromise.js";

class InAnimationFrameSubscription implements InnerSubscription {
  constructor(public id: ReturnType<typeof requestAnimationFrame>) {}

  unsubscribe() {
    cancelAnimationFrame(this.id);
  }
}

class InAnimationFrameProducer implements Producer<DOMHighResTimeStamp> {
  produce(innerSubscriber: InnerSubscriber<DOMHighResTimeStamp>) {
    return new InAnimationFrameSubscription(
      requestAnimationFrame((timestamp) => {
        innerSubscriber.resolve(timestamp);
      }),
    );
  }
}

/**
 * Returns a lazy promise that resolves with `DOMHighResTimeStamp` in an
 * animation frame.
 */
export const inAnimationFrame = (): LazyPromise<DOMHighResTimeStamp> =>
  new LazyPromise(new InAnimationFrameProducer());
