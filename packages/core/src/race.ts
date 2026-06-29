import type {
  InnerSubscriber,
  InnerSubscription,
  Producer,
  Subscriber,
  Subscription,
  Unbox,
} from "./lazyPromise.js";
import { LazyPromise } from "./lazyPromise.js";

class RaceSubscriberSubscription implements Subscriber<any>, InnerSubscription {
  subscriptions: Subscription[] = [];
  settled = false;

  constructor(public innerSubscriber: InnerSubscriber<any>) {}

  resolve(value: any) {
    this.innerSubscriber.resolve(value);
    this.settled = true;
    this.dispose();
  }

  reject(error: any) {
    this.innerSubscriber.reject(error);
    this.settled = true;
    this.dispose();
  }

  dispose() {
    for (let index = 0; index < this.subscriptions.length; index++) {
      this.subscriptions[index]!.dispose();
    }
  }
}

class RaceProducer implements Producer<any> {
  constructor(public sources: Iterable<any>) {}

  produce(innerSubscriber: InnerSubscriber<any>) {
    const innerSubscription = new RaceSubscriberSubscription(innerSubscriber);
    for (const source of this.sources) {
      if (source instanceof LazyPromise) {
        innerSubscription.subscriptions.push(
          source.subscribe(innerSubscription),
        );
        if (innerSubscription.settled) {
          return;
        }
        continue;
      }
      innerSubscriber.resolve(source);
      innerSubscription.dispose();
      return;
    }
    return innerSubscription;
  }
}

/**
 * The LazyPromise equivalent of `Promise.race`.
 */
export const race = <Source>(
  sources: Iterable<Source>,
): LazyPromise<Unbox<Source>> => new LazyPromise(new RaceProducer(sources));
