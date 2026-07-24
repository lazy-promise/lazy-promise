import type { Disposable, Producer, Sink } from "./lazyPromise.js";
import { LazyPromise } from "./lazyPromise.js";

class InTimeoutJob implements Disposable {
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
 *
 * To defer execution of a callback, use
 *
 * ```
 * inTimeout(ms).map(() => ...)
 * ```
 *
 * To make an existing LazyPromise settle with a delay, pipe it though
 *
 * ```
 * .finalize(() => inTimeout(ms))
 * ```
 *
 * To delay a promise only when it resolves, use
 *
 * ```
 * map((value) => inTimeout(ms).map(() => value))
 * ```
 */
export const inTimeout = (ms?: number): LazyPromise<void> =>
  new LazyPromise(new InTimeoutProducer(ms));
