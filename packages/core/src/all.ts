import type {
  Flatten,
  InnerSubscriber,
  InnerSubscription,
  Producer,
  Subscriber,
  Subscription,
} from "./lazyPromise.js";
import { LazyPromise, TypedError } from "./lazyPromise.js";
import type {
  NeverIfArrayContainsNever,
  NeverIfRecordContainsNever,
} from "./utils.js";

class AllSubscriber implements Subscriber<any> {
  constructor(
    public key: any,
    // eslint-disable-next-line no-use-before-define
    public innerSubscription: AllSubscription,
  ) {}

  resolve(value: any) {
    const innerSubscription = this.innerSubscription;
    if (value instanceof TypedError) {
      innerSubscription.innerSubscriber.resolve(value);
      innerSubscription.initialized = true;
      innerSubscription.unsubscribe();
      return;
    }
    innerSubscription.values[this.key] = value;
    if (innerSubscription.initialized && innerSubscription.pendingCount === 1) {
      innerSubscription.innerSubscriber.resolve(innerSubscription.values);
      // No need to unsubscribe since all sources that are promises have
      // resolved.
      return;
    }
    innerSubscription.pendingCount--;
  }

  reject(error: any) {
    const innerSubscription = this.innerSubscription;
    innerSubscription.innerSubscriber.reject(error);
    innerSubscription.initialized = true;
    innerSubscription.unsubscribe();
  }
}

class AllSubscription implements InnerSubscription {
  // A sparse array or an object.
  values: any;
  subscriptions: Subscription[] = [];
  pendingCount = 0;
  initialized = false;

  constructor(public innerSubscriber: InnerSubscriber<any>) {}

  next(key: any, source: any) {
    if (source instanceof LazyPromise) {
      this.pendingCount++;
      this.subscriptions.push(source.subscribe(new AllSubscriber(key, this)));
      return;
    }
    if (source instanceof TypedError) {
      this.innerSubscriber.resolve(source);
      this.initialized = true;
      this.unsubscribe();
      return;
    }
    this.values[key] = source;
  }

  unsubscribe() {
    for (let index = 0; index < this.subscriptions.length; index++) {
      this.subscriptions[index]!.unsubscribe();
    }
  }
}

class AllProducer implements Producer<any> {
  constructor(public sources: Iterable<any> | Record<any, any>) {}

  produce(innerSubscriber: InnerSubscriber<any>) {
    const innerSubscription = new AllSubscription(innerSubscriber);
    if (Symbol.iterator in this.sources) {
      innerSubscription.values = [];
      let index = 0;
      for (const source of this.sources) {
        innerSubscription.next(index, source);
        if (innerSubscription.initialized) {
          return;
        }
        index++;
      }
    } else {
      innerSubscription.values = {};
      for (const key in this.sources) {
        innerSubscription.next(key, this.sources[key]);
        if (innerSubscription.initialized) {
          return;
        }
      }
    }
    if (innerSubscription.pendingCount === 0) {
      innerSubscriber.resolve(innerSubscription.values);
      // No need to unsubscribe since all sources that are promises have
      // resolved.
      return;
    }
    innerSubscription.initialized = true;
    return innerSubscription;
  }
}

/**
 * The LazyPromise equivalent of `Promise.all`. In addition to an iterable,
 * accepts inputs in the form of a plain object (in that case a successful
 * result is an object with the same keys).
 */
export const all: {
  <const Sources extends any[]>(
    sources: [...Sources],
  ): LazyPromise<
    | NeverIfArrayContainsNever<{
        [Key in keyof Sources]: Exclude<Flatten<Sources[Key]>, TypedError<any>>;
      }>
    | Extract<Flatten<Sources[number]>, TypedError<any>>
  >;
  <const Source = never>(
    sources: Iterable<Source>,
  ): LazyPromise<
    | Exclude<Flatten<Source>, TypedError<any>>[]
    | Extract<Flatten<Source>, TypedError<any>>
  >;
  <const Sources extends Record<any, any>>(
    sources: Sources,
  ): LazyPromise<
    | NeverIfRecordContainsNever<{
        [Key in keyof Sources]: Exclude<Flatten<Sources[Key]>, TypedError<any>>;
      }>
    | Extract<Flatten<Sources[keyof Sources]>, TypedError<any>>
  >;
} = (sources: Iterable<any> | Record<any, any>): LazyPromise<any> =>
  new LazyPromise(new AllProducer(sources));
