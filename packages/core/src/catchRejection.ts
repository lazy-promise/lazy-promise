import type {
  Flatten,
  InnerSubscriber,
  Producer,
  Subscriber,
} from "./lazyPromise";
import { LazyPromise } from "./lazyPromise";

class CatchRejectionSubscriber implements Subscriber<any> {
  constructor(
    public innerSubscriber: InnerSubscriber<any>,
    public callback: (value: any) => any,
  ) {}

  resolve(value: any) {
    this.innerSubscriber.resolve(value);
  }

  reject(error: any) {
    let newValue;
    try {
      newValue = (0, this.callback)(error);
    } catch (callbackError) {
      this.innerSubscriber.reject(callbackError);
      return;
    }
    this.innerSubscriber.resolve(newValue);
  }
}

class CatchRejectionProducer implements Producer<any> {
  constructor(
    public source: LazyPromise<any>,
    public callback: (value: any) => any,
  ) {}

  produce(innerSubscriber: InnerSubscriber<any>) {
    return this.source.subscribe(
      new CatchRejectionSubscriber(innerSubscriber, this.callback),
    );
  }
}

/**
 * The LazyPromise equivalent of `promise.catch(...)`.
 */
export const catchRejection =
  <NewValue>(callback: (error: unknown) => NewValue) =>
  <Value>(source: LazyPromise<Value>): LazyPromise<Value | Flatten<NewValue>> =>
    new LazyPromise(new CatchRejectionProducer(source, callback));
