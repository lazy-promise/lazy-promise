import type {
  Consumer,
  InferDep,
  Job,
  Producer,
  Sink,
  Subscription,
  Unbox,
  Yieldable,
} from "./lazyPromise.js";
import { LazyPromise } from "./lazyPromise.js";

interface SubscriptionNode {
  subscription: Subscription;
  next: SubscriptionNode | undefined;
}

class RaceConsumerJob implements Consumer<any>, Job {
  subscriptions?: SubscriptionNode;
  settled = false;

  constructor(
    public sink: Sink<any>,
    public dep: any,
  ) {}

  /**
   * The return value indicates whether the promise has settled.
   */
  next(source: any) {
    if (source instanceof LazyPromise) {
      const subscription = source.subscribe<any>(this, this.dep);
      if (this.settled) {
        return true;
      }
      this.subscriptions = { subscription, next: this.subscriptions };
      return false;
    }
    this.resolve(source);
    return true;
  }

  resolve(value: any) {
    this.sink.resolve(value);
    this.settled = true;
    this.dispose();
  }

  reject(error: unknown) {
    this.sink.reject(error);
    this.settled = true;
    this.dispose();
  }

  dispose() {
    let node = this.subscriptions;
    while (node) {
      node.subscription.dispose();
      node = node.next;
    }
  }
}

class RaceProducer implements Producer<any, any> {
  constructor(public sources: Iterable<any>) {}

  produce(sink: Sink<any>, dep: any) {
    const job = new RaceConsumerJob(sink, dep);
    if (Array.isArray(this.sources)) {
      for (let index = 0; index < this.sources.length; index++) {
        if (job.next(this.sources[index])) {
          return;
        }
      }
    } else {
      for (const source of this.sources) {
        if (job.next(source)) {
          return;
        }
      }
    }
    return job;
  }
}

/**
 * The LazyPromise equivalent of `Promise.race`.
 */
export const race: {
  <Source>(
    sources: Iterable<Source>,
  ): [Source] extends [never]
    ? LazyPromise<never>
    : [Source] extends [Yieldable]
      ? never
      : LazyPromise<Unbox<Source>, InferDep<Source>>;
} = ((sources: Iterable<any>): any => {
  if (sources instanceof LazyPromise) {
    throw new Error(
      `A LazyPromise passed to race(...) must be wrapped in an Iterable such as an array.`,
    );
  }
  return new LazyPromise(new RaceProducer(sources));
}) as any;
