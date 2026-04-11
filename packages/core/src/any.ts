import type {
  InnerSubscriber,
  InnerSubscription,
  Producer,
  Subscriber,
  Subscription,
  Unbox,
} from "./lazyPromise.js";
import { LazyPromise, TypedError } from "./lazyPromise.js";
import type {
  NeverIfArrayContainsNever,
  NeverIfRecordContainsNever,
} from "./utils.js";

class AnySubscriber implements Subscriber<any> {
  constructor(
    public key: any,
    // eslint-disable-next-line no-use-before-define
    public innerSubscription: AnySubscription,
  ) {}

  resolve(value: any) {
    const innerSubscription = this.innerSubscription;
    if (value instanceof TypedError) {
      innerSubscription.errors[this.key] = value.error;
      if (
        innerSubscription.initialized &&
        innerSubscription.pendingCount === 1
      ) {
        innerSubscription.innerSubscriber.resolve(
          new TypedError(innerSubscription.errors),
        );
        // No need to unsubscribe since all sources that are promises have
        // resolved.
        return;
      }
      innerSubscription.pendingCount--;
      return;
    }
    innerSubscription.innerSubscriber.resolve(value);
    innerSubscription.initialized = true;
    innerSubscription.unsubscribe();
    return;
  }

  reject(error: any) {
    const innerSubscription = this.innerSubscription;
    innerSubscription.innerSubscriber.reject(error);
    innerSubscription.initialized = true;
    innerSubscription.unsubscribe();
  }
}

class AnySubscription implements InnerSubscription {
  // A sparse array or an object.
  errors: any;
  subscriptions: Subscription[] = [];
  pendingCount = 0;
  initialized = false;

  constructor(public innerSubscriber: InnerSubscriber<any>) {}

  next(key: any, source: any) {
    if (source instanceof LazyPromise) {
      this.pendingCount++;
      this.subscriptions.push(source.subscribe(new AnySubscriber(key, this)));
      return;
    }
    if (source instanceof TypedError) {
      this.errors[key] = source.error;
      return;
    }
    this.innerSubscriber.resolve(source);
    this.initialized = true;
    this.unsubscribe();
  }

  unsubscribe() {
    for (let index = 0; index < this.subscriptions.length; index++) {
      this.subscriptions[index]!.unsubscribe();
    }
  }
}

class AnyProducer implements Producer<any> {
  constructor(public sources: Iterable<any> | Record<any, any>) {}

  produce(innerSubscriber: InnerSubscriber<any>) {
    const innerSubscription = new AnySubscription(innerSubscriber);
    if (Symbol.iterator in this.sources) {
      innerSubscription.errors = [];
      let index = 0;
      for (const source of this.sources) {
        innerSubscription.next(index, source);
        if (innerSubscription.initialized) {
          return;
        }
        index++;
      }
    } else {
      innerSubscription.errors = {};
      for (const key in this.sources) {
        innerSubscription.next(key, this.sources[key]);
        if (innerSubscription.initialized) {
          return;
        }
      }
    }
    if (innerSubscription.pendingCount === 0) {
      innerSubscriber.resolve(new TypedError(innerSubscription.errors));
      // No need to unsubscribe since all sources that are promises have
      // resolved.
      return;
    }
    innerSubscription.initialized = true;
    return innerSubscription;
  }
}

type TypedErrorOrNever<Error> = Error extends never ? never : TypedError<Error>;
type UnwrapTypedError<T> = T extends TypedError<infer Error> ? Error : never;

/**
 * Acts as `Promise.any` with respect to typed errors. In addition to an
 * iterable, accepts inputs in the form of a plain object.
 *
 * If one of the inputs resolves with a value other than a typed error, the
 * resulting promise will immediately resolve with that value.
 *
 * If all inputs resolve with typed errors, the resulting promise will resolve
 * with a typed error that wraps an array (if the inputs we provided as an
 * iterable) or an object (if the inputs were provided as an object) with the
 * errors.
 *
 * If one of the inputs rejects, the resulting promise will immediately pass on
 * the untyped error.
 */
export const any: {
  <const Sources extends any[]>(
    sources: [...Sources],
  ): LazyPromise<
    | Exclude<Unbox<Sources[number]>, TypedError<any>>
    | TypedErrorOrNever<
        NeverIfArrayContainsNever<{
          [Key in keyof Sources]: UnwrapTypedError<Unbox<Sources[Key]>>;
        }>
      >
  >;
  <const Source = never>(
    sources: Iterable<Source>,
  ): LazyPromise<
    | Exclude<Unbox<Source>, TypedError<any>>
    | TypedError<UnwrapTypedError<Unbox<Source>>[]>
  >;
  <const Sources extends Record<any, any>>(
    sources: Sources,
  ): LazyPromise<
    | Exclude<Unbox<Sources[keyof Sources]>, TypedError<any>>
    | TypedErrorOrNever<
        NeverIfRecordContainsNever<{
          [Key in keyof Sources]: UnwrapTypedError<Unbox<Sources[Key]>>;
        }>
      >
  >;
} = (sources: Iterable<LazyPromise<any>>): LazyPromise<any> =>
  new LazyPromise(new AnyProducer(sources));
