import type { LazyPromise, Subscriber, Subscription } from "./lazyPromise.js";

class ToEagerSubscriberListener
  implements Subscriber<any>, EventListenerObject
{
  subscription?: Subscription;
  settled = false;

  constructor(
    public resolveNative: (value: any) => void,
    public rejectNative: (error: any) => void,
    public signal: AbortSignal,
  ) {}

  resolve(value: any) {
    this.settled = true;
    this.signal.removeEventListener("abort", this);
    this.resolveNative(value);
  }

  reject(error: any) {
    this.settled = true;
    this.signal.removeEventListener("abort", this);
    this.rejectNative(error);
  }

  handleEvent() {
    this.signal.removeEventListener("abort", this);
    this.subscription!.unsubscribe();
    this.rejectNative(this.signal.reason);
  }
}

/**
 * Converts a LazyPromise to a Promise. You can pass an AbortSignal in the
 * options object.
 */
export const toEager = <Value>(
  lazyPromise: LazyPromise<Value>,
  options?: { readonly signal?: AbortSignal },
): Promise<Value> =>
  new Promise((resolve, reject) => {
    const signal = options?.signal;
    if (!signal) {
      lazyPromise.subscribe({ resolve, reject });
      return;
    }
    signal.throwIfAborted();
    const subscriberListener = new ToEagerSubscriberListener(
      resolve,
      reject,
      signal,
    );
    const subscription = lazyPromise.subscribe(subscriberListener);
    if (subscriberListener.settled) {
      return;
    }
    if (signal.aborted) {
      subscription.unsubscribe();
      throw signal.reason;
    }
    subscriberListener.subscription = subscription;
    signal.addEventListener("abort", subscriberListener);
  });
