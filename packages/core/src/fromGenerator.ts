import type {
  Flatten,
  InnerSubscriber,
  InnerSubscription,
  Producer,
  Subscriber,
  Subscription,
  Yieldable,
} from "./lazyPromise.js";
import { LazyPromise } from "./lazyPromise.js";

export type LazyPromiseGenerator<TReturn> = Generator<Yieldable, TReturn>;

const emptySymbol = Symbol("empty");

class FromGeneratorSubscriberSubscription<TReturn>
  implements Subscriber<any>, InnerSubscription
{
  // The value that a yielded promise resolved to.
  value: any = emptySymbol;
  // The error that a yielded promise rejected with.
  error: any = emptySymbol;
  subscription: Subscription | undefined;
  unsubscribed = false;

  constructor(
    public innerSubscriber: InnerSubscriber<any>,
    public generator: Generator<Yieldable, TReturn, any>,
  ) {}

  resolve(value: any) {
    // When possible, use the while loop to avoid increasing stack depth.
    if (this.subscription === undefined) {
      this.value = value;
      return;
    }
    try {
      // May throw.
      const generatorResult = this.generator.next(value);
      if (this.unsubscribed) {
        return;
      }
      this.subscription = undefined;
      // May throw.
      this.next(generatorResult);
    } catch (error) {
      this.innerSubscriber.reject(error);
    }
  }

  reject(error: any) {
    // When possible, use the while loop to avoid increasing stack depth.
    if (this.subscription === undefined) {
      this.error = error;
      return;
    }
    try {
      // May throw.
      const generatorResult = this.generator.throw(error);
      if (this.unsubscribed) {
        return;
      }
      this.subscription = undefined;
      // May throw.
      this.next(generatorResult);
    } catch (error) {
      this.innerSubscriber.reject(error);
    }
  }

  // May throw.
  next(generatorResult: IteratorResult<Yieldable, TReturn | void>) {
    while (true) {
      if (generatorResult.done) {
        this.innerSubscriber.resolve(generatorResult.value);
        return;
      }
      const subscription = generatorResult.value.subscribe(this);
      if (this.unsubscribed) {
        subscription.unsubscribe();
        return;
      }
      if (this.value !== emptySymbol) {
        // May throw.
        generatorResult = this.generator.next(this.value);
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (this.unsubscribed) {
          return;
        }
        this.subscription = undefined;
        this.value = emptySymbol;
        continue;
      }
      if (this.error !== emptySymbol) {
        // May throw.
        generatorResult = this.generator.throw(this.error);
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (this.unsubscribed) {
          return;
        }
        this.subscription = undefined;
        this.error = emptySymbol;
        continue;
      }
      this.subscription = subscription;
      return;
    }
  }

  unsubscribe() {
    this.unsubscribed = true;
    this.subscription?.unsubscribe();
  }
}

class FromGeneratorProducer<TReturn> implements Producer<any> {
  constructor(public generatorFunction: () => LazyPromiseGenerator<TReturn>) {}

  produce(innerSubscriber: InnerSubscriber<any>) {
    // This may throw and cause promise rejection.
    const generator = (0, this.generatorFunction)();
    const innerSubscription = new FromGeneratorSubscriberSubscription(
      innerSubscriber,
      generator,
    );
    // This may throw and cause promise rejection.
    innerSubscription.next(
      // This may throw and cause promise rejection.
      generator.next(),
    );
    return innerSubscription;
  }
}

/**
 * Converts a generator function to a LazyPromise.
 */
export const fromGenerator = <TReturn>(
  generatorFunction: () => LazyPromiseGenerator<TReturn>,
): LazyPromise<Flatten<TReturn>> =>
  new LazyPromise<any>(new FromGeneratorProducer(generatorFunction));
