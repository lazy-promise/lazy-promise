import type { Job, Producer, Sink } from "./lazyPromise.js";
import { LazyPromise } from "./lazyPromise.js";

class InTimeoutJob implements Job {
  constructor(public id: ReturnType<typeof setTimeout>) {}

  dispose() {
    clearTimeout(this.id);
  }
}

const callback = (sink: Sink<void>) => {
  sink.resolve();
};

class InTimeoutProducer implements Producer<void> {
  constructor(public ms?: number) {}

  produce(sink: Sink<void>) {
    return new InTimeoutJob(setTimeout(callback, this.ms, sink));
  }
}

/**
 * Takes optional duration in ms, and returns a LazyPromise that resolves with a
 * value of type `void` when setTimeout fires.
 */
export const inTimeout = (ms?: number): LazyPromise<void> =>
  new LazyPromise(new InTimeoutProducer(ms));
