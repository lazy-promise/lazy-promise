import type { Consumer, LazyPromise, Producer, Sink } from "./lazyPromise.js";
import { ErrorBox } from "./lazyPromise.js";

class CatchBoxedErrorConsumer implements Consumer<any> {
  constructor(
    public sink: Sink<any>,
    public callback: (value: any) => any,
  ) {}

  resolve(value: any) {
    if (value instanceof ErrorBox) {
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

export class CatchBoxedErrorProducer implements Producer<any> {
  constructor(
    public source: LazyPromise<any>,
    public callback: (value: any) => any,
  ) {}

  produce(sink: Sink<any>) {
    return this.source.subscribe(
      new CatchBoxedErrorConsumer(sink, this.callback),
    );
  }
}
