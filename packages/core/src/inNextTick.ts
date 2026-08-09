import type { Producer, Sink } from "./lazyPromise.js";
import { LazyPromise } from "./lazyPromise.js";

const callback = (sink: Sink<void>) => {
  sink.resolve();
};

class InNextTickProducer implements Producer<void> {
  produce(sink: Sink<void>) {
    process.nextTick(callback, sink);
  }
}

/**
 * Returns a LazyPromise that resolves with a value of type `void` in
 * process.nextTick (Node-only).
 */
export const inNextTick = (): LazyPromise<void> =>
  new LazyPromise(new InNextTickProducer());
