import type {
  InnerSubscriber,
  InnerSubscription,
  Producer,
} from "./lazyPromise.js";
import { LazyPromise } from "./lazyPromise.js";

class InScheduledSubscription
  extends AbortController
  implements InnerSubscription
{
  unsubscribe() {
    this.abort();
  }
}

const noop = () => {};

class InScheduledProducer implements Producer<void> {
  constructor(
    public options?: {
      priority?: TaskPriority;
    },
  ) {}

  produce(innerSubscriber: InnerSubscriber<void>) {
    const subscription = new InScheduledSubscription();
    scheduler
      .postTask(
        () => {
          innerSubscriber.resolve();
        },
        {
          priority: this.options?.priority!,
          signal: subscription.signal,
        },
      )
      // Catch abort error.
      .catch(noop);
    return subscription;
  }
}

/**
 * Takes an optional object with task priority ("user-visible" by default), and
 * returns a lazy promise that resolves with a value of type `void` in a
 * `scheduler.postTask` callback.
 *
 * To defer execution of a callback, use
 *
 * ```
 * inScheduled().map(() => ...)
 * ```
 *
 * To make an existing lazy promise settle via `scheduler`, pipe it though
 *
 * ```
 * .finalize(inScheduled)
 * ```
 *
 * To limit this to only when the promise resolves, use
 *
 * ```
 * map((value) => inScheduled().map(() => value))
 * ```
 */
export const inScheduled = (options?: {
  priority?: TaskPriority;
}): LazyPromise<void> => new LazyPromise(new InScheduledProducer(options));
