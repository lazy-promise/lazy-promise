import type { InnerSubscriber, Producer } from "./lazyPromise";
import { LazyPromise } from "./lazyPromise";

const callback = (innerSubscriber: InnerSubscriber<void>) => {
  innerSubscriber.resolve();
};

class InNextTickProducer implements Producer<void> {
  produce(innerSubscriber: InnerSubscriber<void>) {
    process.nextTick(callback, innerSubscriber);
  }
}

/**
 * Returns a lazy promise that resolves with a value of type `void` in
 * process.nextTick (Node-only).
 *
 * To defer execution of a callback, use
 *
 * ```
 * inNextTick().pipe(map(() => ...))
 * ```
 *
 * To make an existing lazy promise settle via nextTick, pipe it though
 *
 * ```
 * finalize(inNextTick)
 * ```
 *
 * To limit this to only when the promise resolves, use
 *
 * ```
 * map((value) => inNextTick().pipe(map(() => value)))
 * ```
 */
export const inNextTick = (): LazyPromise<void> =>
  new LazyPromise(new InNextTickProducer());
