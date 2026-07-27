import type { Consumer, LazyPromise, Producer, Sink } from "./lazyPromise.js";
import { ErrorBox } from "./lazyPromise.js";

class CatchBoxedErrorConsumer implements Consumer<any> {
  constructor(
    public sink: Sink<any>,
    public callback: (value: any, dep: any) => any,
    public dep: any,
  ) {}

  resolve(value: any) {
    if (value instanceof ErrorBox) {
      let newValue;
      try {
        newValue = (0, this.callback)(value.error, this.dep);
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

export class CatchBoxedErrorProducer implements Producer<any, any> {
  constructor(
    public source: LazyPromise<any, any>,
    public callback: (value: any, dep: any) => any,
  ) {}

  produce(sink: Sink<any>, dep: any) {
    return this.source.subscribe<any>(
      new CatchBoxedErrorConsumer(sink, this.callback, dep),
      dep,
    );
  }
}
