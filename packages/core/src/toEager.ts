import type { Consumer, Disposable, LazyPromise } from "./lazyPromise.js";

class ToEagerConsumerListener implements Consumer<any>, EventListenerObject {
  subscription?: Disposable;
  settled = false;

  constructor(
    public resolveNative: (value: any) => void,
    public rejectNative: (error: unknown) => void,
    public signal: AbortSignal,
  ) {}

  resolve(value: any) {
    this.settled = true;
    this.signal.removeEventListener("abort", this);
    this.resolveNative(value);
  }

  reject(error: unknown) {
    this.settled = true;
    this.signal.removeEventListener("abort", this);
    this.rejectNative(error);
  }

  handleEvent() {
    this.signal.removeEventListener("abort", this);
    this.subscription!.dispose();
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
    const consumerListener = new ToEagerConsumerListener(
      resolve,
      reject,
      signal,
    );
    const subscription = lazyPromise.subscribe(consumerListener);
    if (consumerListener.settled) {
      return;
    }
    if (signal.aborted) {
      subscription.dispose();
      throw signal.reason;
    }
    consumerListener.subscription = subscription;
    signal.addEventListener("abort", consumerListener);
  });
