import type {
  InnerSubscriber,
  LazyPromise,
  Producer,
  Subscriber,
} from "./lazyPromise.js";
import { TypedError } from "./lazyPromise.js";

class MapSubscriber implements Subscriber<any> {
  constructor(
    public innerSubscriber: InnerSubscriber<any>,
    public callback: (value: any) => any,
  ) {}

  resolve(value: any) {
    if (value instanceof TypedError) {
      this.innerSubscriber.resolve(value);
      return;
    }
    let newValue;
    try {
      newValue = (0, this.callback)(value);
    } catch (callbackError) {
      this.innerSubscriber.reject(callbackError);
      return;
    }
    this.innerSubscriber.resolve(newValue);
  }

  reject(error: any) {
    this.innerSubscriber.reject(error);
  }
}

export class MapProducer implements Producer<any> {
  constructor(
    public source: LazyPromise<any>,
    public callback: (value: any) => any,
  ) {}

  produce(innerSubscriber: InnerSubscriber<any>) {
    return this.source.subscribe(
      new MapSubscriber(innerSubscriber, this.callback),
    );
  }
}
