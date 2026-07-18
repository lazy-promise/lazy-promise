import type { Disposable, Producer, Sink } from "./lazyPromise.js";
import { LazyPromise } from "./lazyPromise.js";

class InIdleCallbackJob implements Disposable {
  constructor(public id: ReturnType<typeof requestIdleCallback>) {}

  dispose() {
    cancelIdleCallback(this.id);
  }
}

class InIdleCallbackProducer implements Producer<IdleDeadline> {
  constructor(public options?: IdleRequestOptions) {}

  produce(sink: Sink<IdleDeadline>) {
    return new InIdleCallbackJob(
      requestIdleCallback((idleDeadline) => {
        sink.resolve(idleDeadline);
      }, this.options),
    );
  }
}

/**
 * Takes optional IdleRequestOptions, and returns a lazy promise that resolves
 * with `IdleDeadline` in an idle callback.
 *
 * To defer execution of a callback, use
 *
 * ```
 * inIdleCallback().map(() => ...)
 * ```
 *
 * To make an existing lazy promise settle in an idle callback, pipe it though
 *
 * ```
 * .finalize(inIdleCallback)
 * ```
 *
 * To limit this to only when the promise resolves, use
 *
 * ```
 * map((value) => inIdleCallback().map(() => value))
 * ```
 */
export const inIdleCallback = (
  options?: IdleRequestOptions,
): LazyPromise<IdleDeadline> =>
  new LazyPromise(new InIdleCallbackProducer(options));
