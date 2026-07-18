import type { Consumer, LazyPromise, Producer, Sink } from "./lazyPromise.js";
import { TypedError } from "./lazyPromise.js";

class CatchTypedErrorConsumer implements Consumer<any> {
  constructor(
    public sink: Sink<any>,
    public callback: (value: any) => any,
  ) {}

  resolve(value: any) {
    if (value instanceof TypedError) {
      let newValue;
      try {
        newValue = (0, this.callback)(value.error);
      } catch (callbackError) {
        this.sink.reject(callbackError);
        return;
      }
      this.sink.resolve(newValue);
      return;
    }
    this.sink.resolve(value);
  }

  reject(error: unknown) {
    this.sink.reject(error);
  }
}

export class CatchTypedErrorProducer implements Producer<any> {
  constructor(
    public source: LazyPromise<any>,
    public callback: (value: any) => any,
  ) {}

  produce(sink: Sink<any>) {
    return this.source.subscribe(
      new CatchTypedErrorConsumer(sink, this.callback),
    );
  }
}
