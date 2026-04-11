import type {
  InnerSubscriber,
  InnerSubscription,
  Producer,
  Unbox,
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
    public callback: (options: { readonly signal: AbortSignal }) => any,
  ) {}

  produce(innerSubscriber: InnerSubscriber<any>) {
    const innerSubscription = new FromEagerSubscription();
    // May throw.
    const callbackReturn = (0, this.callback)(innerSubscription.options);
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
 * Converts a Promise to a LazyPromise. The callback can use an AbortSignal
 * passed in the options object.
 */
export const fromEager = <Value>(
  callback: (options: { readonly signal: AbortSignal }) => Value,
): LazyPromise<
  Value extends Promise<infer PromiseValue> ? Unbox<PromiseValue> : Unbox<Value>
> => new LazyPromise<any>(new FromEagerProducer(callback));
