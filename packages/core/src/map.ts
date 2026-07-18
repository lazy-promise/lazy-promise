import type { Consumer, LazyPromise, Producer, Sink } from "./lazyPromise.js";
import { TypedError } from "./lazyPromise.js";

class MapConsumer implements Consumer<any> {
  constructor(
    public sink: Sink<any>,
    public callback: (value: any) => any,
  ) {}

  resolve(value: any) {
    if (value instanceof TypedError) {
      this.sink.resolve(value);
      return;
    }
    let newValue;
    try {
      newValue = (0, this.callback)(value);
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

export class MapProducer implements Producer<any> {
  constructor(
    public source: LazyPromise<any>,
    public callback: (value: any) => any,
  ) {}

  produce(sink: Sink<any>) {
    return this.source.subscribe(new MapConsumer(sink, this.callback));
  }
}
