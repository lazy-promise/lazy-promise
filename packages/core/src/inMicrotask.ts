import type { InnerSubscriber, Producer } from "./lazyPromise";
import { LazyPromise } from "./lazyPromise";

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
 * To make an existing lazy promise settle in a microtask, pipe it though
 *
 * ```
 * finalize(inMicrotask)
 * ```
 *
 * To limit this to only when the promise resolves, use
 *
 * ```
 * map((value) => inMicrotask().pipe(map(() => value)))
 * ```
 */
export const inMicrotask = (): LazyPromise<void> =>
  new LazyPromise(new InMicrotaskProducer());
