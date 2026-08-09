import type { Consumer, LazyPromise, Producer, Sink } from "./lazyPromise.js";

class CatchConsumer implements Consumer<any> {
  constructor(
    public sink: Sink<any>,
    public callback: (value: unknown, dep: any) => any,
    public dep: any,
  ) {}

  resolve(value: any) {
    this.sink.resolve(value);
  }

  reject(error: unknown) {
    let newValue;
    try {
      newValue = (0, this.callback)(error, this.dep);
    } catch (callbackError) {
      this.sink.reject(callbackError);
      return;
    }
    this.sink.resolve(newValue);
  }
}

export class CatchProducer implements Producer<any, any> {
  constructor(
    public source: LazyPromise<any, any>,
    public callback: (value: unknown, dep: any) => any,
  ) {}

  produce(sink: Sink<any>, dep: any) {
    return this.source.subscribe<any>(
      new CatchConsumer(sink, this.callback, dep),
      dep,
    );
  }
}
