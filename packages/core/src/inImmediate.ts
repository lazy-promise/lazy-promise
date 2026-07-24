import type { Disposable, Producer, Sink } from "./lazyPromise.js";
import { LazyPromise } from "./lazyPromise.js";

class InImmediateJob implements Disposable {
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
 *
 * To defer execution of a callback, use
 *
 * ```
 * inImmediate().map(() => ...)
 * ```
 *
 * To make an existing LazyPromise settle via setImmediate, pipe it though
 *
 * ```
 * .finalize(inImmediate)
 * ```
 *
 * To limit this to only when the promise resolves, use
 *
 * ```
 * map((value) => inImmediate().map(() => value))
 * ```
 */
export const inImmediate = (): LazyPromise<void> =>
  new LazyPromise(new InImmediateProducer());
