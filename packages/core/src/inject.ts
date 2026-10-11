import type { LazyPromise, Producer, Sink } from "./lazyPromise.js";

export class InjectProducer implements Producer<any, any> {
  constructor(
    public source: LazyPromise<any, any>,
    public callback: (dep: any) => any,
  ) {}

  produce(sink: Sink<any>, dep: any) {
    // This may throw and cause promise rejection.
    sink.subscription.dep = (0, this.callback)(dep);
    // Flattens into the source instead of subscribing to it, so that the
    // source producer runs from the trampoline in `Subscription.next`.
    sink.resolve(this.source);
  }
}
