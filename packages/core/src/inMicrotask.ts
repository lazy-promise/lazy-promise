import type { InnerSubscriber, Producer } from "./lazyPromise.js";
import { LazyPromise } from "./lazyPromise.js";

class InMicrotaskProducer implements Producer<void> {
  produce(innerSubscriber: InnerSubscriber<void>) {
    queueMicrotask(() => {
      innerSubscriber.resolve();
    });
  }
}

/**
 * Returns a lazy promise that resolves in a microtask with a value of type
 * `void`.
 *
 * To defer execution of a callback, use
 *
 * ```
 * inMicrotask().map(() => ...)
 * ```
 *
 * To make an existing lazy promise settle in a microtask, pipe it though
 *
 * ```
 * .finalize(inMicrotask)
 * ```
 *
 * To limit this to only when the promise resolves, use
 *
 * ```
 * map((value) => inMicrotask().map(() => value))
 * ```
 */
export const inMicrotask = (): LazyPromise<void> =>
  new LazyPromise(new InMicrotaskProducer());
