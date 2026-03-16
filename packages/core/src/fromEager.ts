import type {
  Flatten,
  InnerSubscriber,
  InnerSubscription,
  Producer,
} from "./lazyPromise.js";
import { LazyPromise } from "./lazyPromise.js";

class FromEagerOptions {
  /** @internal */
  abortController?: AbortController;

  get signal() {
    if (!this.abortController) {
      this.abortController = new AbortController();
    }
    return this.abortController.signal;
  }
}

class FromEagerSubscription implements InnerSubscription {
  options = new FromEagerOptions();

  unsubscribe() {
    this.options.abortController?.abort(
      new DOMException(
        "The lazy promise subscription was unsubscribed.",
        "AbortError",
      ),
    );
  }
}

class FromEagerProducer implements Producer<any> {
  constructor(
    public arg:
      | Promise<any>
      | ((options: { readonly signal: AbortSignal }) => any),
  ) {}

  produce(innerSubscriber: InnerSubscriber<any>) {
    if (this.arg instanceof Promise) {
      this.arg.then(
        (value) => {
          innerSubscriber.resolve(value);
        },
        (error) => {
          innerSubscriber.reject(error);
        },
      );
      return;
    }
    const innerSubscription = new FromEagerSubscription();
    // May throw.
    const callbackReturn = (0, this.arg)(innerSubscription.options);
    if (callbackReturn instanceof Promise) {
      callbackReturn.then(
        (value) => {
          innerSubscriber.resolve(value);
        },
        (error) => {
          innerSubscriber.reject(error);
        },
      );
      return innerSubscription;
    }
    innerSubscriber.resolve(callbackReturn);
  }
}

/**
 * Converts a Promise to a LazyPromise. Takes either a Promise or a callback
 * that may return one. A callback can use an AbortSignal passed in the options
 * object.
 */
export const fromEager: {
  <Value>(arg: Promise<Value>): LazyPromise<Flatten<Value>>;
  <Value>(
    arg: (options: { readonly signal: AbortSignal }) => Value,
  ): LazyPromise<
    Value extends Promise<infer PromiseValue>
      ? Flatten<PromiseValue>
      : Flatten<Value>
  >;
} = (
  arg: Promise<any> | ((options: { readonly signal: AbortSignal }) => any),
) => new LazyPromise<any>(new FromEagerProducer(arg));
