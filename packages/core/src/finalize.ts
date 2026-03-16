import type {
  Flatten,
  InnerSubscriber,
  Producer,
  Subscriber,
  Subscription,
} from "./lazyPromise.js";
import { LazyPromise, TypedError } from "./lazyPromise.js";

const emptySymbol = Symbol("empty");

class FinalizeSubscriberProducer implements Subscriber<any>, Producer<any> {
  subscription: Subscription | undefined;
  // The value that the source promise resolved to.
  value: any = emptySymbol;
  // The error that the source promise rejected with.
  error: any = emptySymbol;

  constructor(
    public innerSubscriber: InnerSubscriber<any>,
    public callback: () => any,
  ) {}

  resolve(value: any) {
    if (this.value !== emptySymbol) {
      this.innerSubscriber.resolve(
        value instanceof TypedError ? value : this.value,
      );
      return;
    }
    if (this.error !== emptySymbol) {
      if (value instanceof TypedError) {
        this.innerSubscriber.resolve(value);
        return;
      }
      this.innerSubscriber.reject(this.error);
      return;
    }
    this.value = value;
    this.innerSubscriber.resolve(new LazyPromise(this));
  }

  reject(error: any) {
    if (this.value !== emptySymbol || this.error !== emptySymbol) {
      this.innerSubscriber.reject(error);
      return;
    }
    this.error = error;
    this.innerSubscriber.resolve(new LazyPromise(this));
  }

  produce(innerSubscriber: InnerSubscriber<any>) {
    this.innerSubscriber = innerSubscriber;
    const callbackResult = (0, this.callback)();
    if (callbackResult instanceof LazyPromise) {
      return callbackResult.subscribe(this);
    }
    this.resolve(callbackResult);
  }
}

class FinalizeProducer implements Producer<any> {
  constructor(
    public source: LazyPromise<any>,
    public callback: () => any,
  ) {}

  produce(innerSubscriber: InnerSubscriber<any>) {
    return this.source.subscribe(
      new FinalizeSubscriberProducer(innerSubscriber, this.callback),
    );
  }
}

/**
 * The LazyPromise equivalent of `promise.finally(...)`. The callback
 * is called if the source promise resolves or rejects, but not if it's
 * unsubscribed before settling.
 */
export const finalize =
  <NewValue>(callback: () => NewValue) =>
  <Value>(
    source: LazyPromise<Value>,
  ): LazyPromise<
    | Value
    | (Flatten<NewValue> extends TypedError<infer Error>
        ? TypedError<Error>
        : never)
  > =>
    new LazyPromise<any>(new FinalizeProducer(source, callback));
