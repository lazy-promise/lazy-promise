import type {
  InnerSubscriber,
  LazyPromise,
  Producer,
  Subscriber,
} from "./lazyPromise.js";

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

export class CatchRejectionProducer implements Producer<any> {
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
