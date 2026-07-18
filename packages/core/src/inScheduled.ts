import type { Disposable, Producer, Sink } from "./lazyPromise.js";
import { LazyPromise } from "./lazyPromise.js";

class InScheduledJob extends AbortController implements Disposable {
  dispose() {
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

  produce(sink: Sink<void>) {
    const job = new InScheduledJob();
    scheduler
      .postTask(
        () => {
          sink.resolve();
        },
        {
          priority: this.options?.priority!,
          signal: job.signal,
        },
      )
      // Catch abort error.
      .catch(noop);
    return job;
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
