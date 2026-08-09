import type { Consumer, Producer, Sink } from "./lazyPromise.js";
import { ErrorBox, LazyPromise } from "./lazyPromise.js";

const emptySymbol = Symbol("empty");

class FinallyConsumerProducer implements Consumer<any>, Producer<any, any> {
  // The value that the source promise resolved to.
  value: any = emptySymbol;
  // The error that the source promise rejected with.
  error: unknown = emptySymbol;

  constructor(
    public sink: Sink<any>,
    public callback: (dep: any) => any,
  ) {}

  resolve(value: any) {
    if (this.value !== emptySymbol) {
      this.sink.resolve(value instanceof ErrorBox ? value : this.value);
      return;
    }
    if (this.error !== emptySymbol) {
      if (value instanceof ErrorBox) {
        this.sink.resolve(value);
        return;
      }
      this.sink.reject(this.error);
      return;
    }
    this.value = value;
    this.sink.resolve(new LazyPromise(this));
  }

  reject(error: unknown) {
    if (this.value !== emptySymbol || this.error !== emptySymbol) {
      this.sink.reject(error);
      return;
    }
    this.error = error;
    this.sink.resolve(new LazyPromise(this));
  }

  produce(sink: Sink<any>, dep: any) {
    this.sink = sink;
    const callbackResult = (0, this.callback)(dep);
    if (callbackResult instanceof LazyPromise) {
      return callbackResult.subscribe<any>(this, dep);
    }
    this.resolve(callbackResult);
  }
}

export class FinallyProducer implements Producer<any, any> {
  constructor(
    public source: LazyPromise<any, any>,
    public callback: (dep: any) => any,
  ) {}

  produce(sink: Sink<any>, dep: any) {
    return this.source.subscribe<any>(
      new FinallyConsumerProducer(sink, this.callback),
      dep,
    );
  }
}
