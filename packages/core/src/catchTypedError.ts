import type {
  InnerSubscriber,
  LazyPromise,
  Producer,
  Subscriber,
} from "./lazyPromise.js";
import { TypedError } from "./lazyPromise.js";

class CatchTypedErrorSubscriber implements Subscriber<any> {
  constructor(
    public innerSubscriber: InnerSubscriber<any>,
    public callback: (value: any) => any,
  ) {}

  resolve(value: any) {
    if (value instanceof TypedError) {
      let newValue;
      try {
        newValue = (0, this.callback)(value.error);
      } catch (callbackError) {
        this.innerSubscriber.reject(callbackError);
        return;
      }
      this.innerSubscriber.resolve(newValue);
      return;
    }
    this.innerSubscriber.resolve(value);
  }

  reject(error: any) {
    this.innerSubscriber.reject(error);
  }
}

export class CatchTypedErrorProducer implements Producer<any> {
  constructor(
    public source: LazyPromise<any>,
    public callback: (value: any) => any,
  ) {}

  produce(innerSubscriber: InnerSubscriber<any>) {
    return this.source.subscribe(
      new CatchTypedErrorSubscriber(innerSubscriber, this.callback),
    );
  }
}
