import type { Consumer, LazyPromise, Producer, Sink } from "./lazyPromise.js";
import { ErrorBox } from "./lazyPromise.js";

class MapConsumer implements Consumer<any> {
  constructor(
    public sink: Sink<any>,
    public callback: (value: any, dep: any) => any,
    public dep: any,
  ) {}

  resolve(value: any) {
    if (value instanceof ErrorBox) {
      this.sink.resolve(value);
      return;
    }
    let newValue;
    try {
      newValue = (0, this.callback)(value, this.dep);
    } catch (callbackError) {
      this.sink.reject(callbackError);
      return;
    }
    this.sink.resolve(newValue);
  }

  reject(error: unknown) {
    this.sink.reject(error);
  }
}

export class MapProducer implements Producer<any, any> {
  constructor(
    public source: LazyPromise<any, any>,
    public callback: (value: any, dep: any) => any,
  ) {}

  produce(sink: Sink<any>, dep: any) {
    return this.source.subscribe<any>(
      new MapConsumer(sink, this.callback, dep),
      dep,
    );
  }
}
