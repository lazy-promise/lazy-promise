import type { Consumer, LazyPromise, Producer, Sink } from "./lazyPromise.js";

class InjectConsumer implements Consumer<any> {
  constructor(public sink: Sink<any>) {}

  resolve(value: any) {
    this.sink.resolve(value);
  }

  reject(error: unknown) {
    this.sink.reject(error);
  }
}

export class InjectProducer implements Producer<any, any> {
  constructor(
    public source: LazyPromise<any, any>,
    public callback: (dep: any) => any,
  ) {}

  produce(sink: Sink<any>, dep: any) {
    // This may throw and cause promise rejection.
    const sourceDep = (0, this.callback)(dep);
    return this.source.subscribe<any>(new InjectConsumer(sink), sourceDep);
  }
}
