import type { InferDep, Producer, Sink, Unbox } from "./lazyPromise.js";
import { LazyPromise } from "./lazyPromise.js";

class DeferProducer implements Producer<any, any> {
  constructor(public callback: (dep: any) => any) {}

  produce(sink: Sink<any, any>, dep: any) {
    // May throw.
    sink.resolve((0, this.callback)(dep));
  }
}

/**
 * The LazyPromise equivalent of `Promise.try(callback)`. A shorter and more
 * efficient version of `box().map(callback)`.
 */
export const defer = <NewValue, ExtraDep = unknown>(
  callback: (dep: ExtraDep) => NewValue,
): LazyPromise<Unbox<NewValue>, ExtraDep & InferDep<NewValue>> =>
  new LazyPromise<any>(new DeferProducer(callback));
