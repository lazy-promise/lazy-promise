import type { Job, Producer, Sink } from "./lazyPromise.js";
import { LazyPromise } from "./lazyPromise.js";

class InImmediateJob implements Job {
  constructor(public id: ReturnType<typeof setImmediate>) {}

  dispose() {
    clearImmediate(this.id);
  }
}

const callback = (sink: Sink<void>) => {
  sink.resolve();
};

class InImmediateProducer implements Producer<void> {
  produce(sink: Sink<void>) {
    return new InImmediateJob(setImmediate(callback, sink));
  }
}

/**
 * Returns a LazyPromise that resolves with a value of type `void` in a
 * setImmediate callback (deprecated outside of Node).
 */
export const inImmediate = (): LazyPromise<void> =>
  new LazyPromise(new InImmediateProducer());
