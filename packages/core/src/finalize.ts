import type { Consumer, Producer, Sink } from "./lazyPromise.js";
import { LazyPromise, TypedError } from "./lazyPromise.js";

const emptySymbol = Symbol("empty");

class FinalizeConsumerProducer implements Consumer<any>, Producer<any> {
  // The value that the source promise resolved to.
  value: any = emptySymbol;
  // The error that the source promise rejected with.
  error: unknown = emptySymbol;

  constructor(
    public sink: Sink<any>,
    public callback: () => any,
  ) {}

  resolve(value: any) {
    if (this.value !== emptySymbol) {
      this.sink.resolve(value instanceof TypedError ? value : this.value);
      return;
    }
    if (this.error !== emptySymbol) {
      if (value instanceof TypedError) {
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

  produce(sink: Sink<any>) {
    this.sink = sink;
    const callbackResult = (0, this.callback)();
    if (callbackResult instanceof LazyPromise) {
      return callbackResult.subscribe(this);
    }
    this.resolve(callbackResult);
  }
}

export class FinalizeProducer implements Producer<any> {
  constructor(
    public source: LazyPromise<any>,
    public callback: () => any,
  ) {}

  produce(sink: Sink<any>) {
    return this.source.subscribe(
      new FinalizeConsumerProducer(sink, this.callback),
    );
  }
}
