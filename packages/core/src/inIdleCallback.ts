import type { Job, Producer, Sink } from "./lazyPromise.js";
import { LazyPromise } from "./lazyPromise.js";

class InIdleCallbackJob implements Job {
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
 * Takes optional IdleRequestOptions, and returns a LazyPromise that resolves
 * with `IdleDeadline` in an idle callback.
 */
export const inIdleCallback = (
  options?: IdleRequestOptions,
): LazyPromise<IdleDeadline> =>
  new LazyPromise(new InIdleCallbackProducer(options));
