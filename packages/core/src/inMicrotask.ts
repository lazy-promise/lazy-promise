import type { Producer, Sink } from "./lazyPromise.js";
import { LazyPromise } from "./lazyPromise.js";

class InMicrotaskProducer implements Producer<void> {
  produce(sink: Sink<void>) {
    queueMicrotask(() => {
      sink.resolve();
    });
  }
}

/**
 * Returns a LazyPromise that resolves in a microtask with a value of type
 * `void`.
 */
export const inMicrotask = (): LazyPromise<void> =>
  new LazyPromise(new InMicrotaskProducer());
