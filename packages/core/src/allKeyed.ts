import type {
  Consumer,
  InferDep,
  Job,
  Producer,
  Sink,
  Subscription,
  Unbox,
} from "./lazyPromise.js";
import { ErrorBox, LazyPromise } from "./lazyPromise.js";
import type { NeverIfObjectContainsNever } from "./utils.js";

interface SubscriptionNode {
  subscription: Subscription;
  next: SubscriptionNode | undefined;
}

class AllKeyedConsumer implements Consumer<any> {
  constructor(
    public key: PropertyKey,
    // eslint-disable-next-line no-use-before-define
    public job: AllKeyedJob,
  ) {}

  resolve(value: any) {
    const job = this.job;
    if (value instanceof ErrorBox) {
      job.initialized = true;
      job.sink.resolve(value);
      return;
    }
    job.values[this.key] = value;
    if (job.initialized && job.pendingCount === 1) {
      job.sink.resolve(job.values);
      return;
    }
    job.pendingCount--;
  }

  reject(error: unknown) {
    const job = this.job;
    job.initialized = true;
    job.sink.reject(error);
  }
}

class AllKeyedJob implements Job {
  values: Record<PropertyKey, any> = { __proto__: null };
  subscriptions?: SubscriptionNode;
  pendingCount = 0;
  initialized = false;

  constructor(
    public sink: Sink<any>,
    public dep: any,
  ) {}

  next(key: PropertyKey, source: any) {
    if (source instanceof LazyPromise) {
      // Reserves the key so the result keeps source key order.
      this.values[key] = undefined;
      this.pendingCount++;
      const subscription = source.subscribe<any>(
        new AllKeyedConsumer(key, this),
        this.dep,
      );
      if (this.initialized) {
        return;
      }
      this.subscriptions = { subscription, next: this.subscriptions };
      return;
    }
    if (source instanceof ErrorBox) {
      this.initialized = true;
      this.sink.resolve(source);
      return;
    }
    this.values[key] = source;
  }

  dispose() {
    let node = this.subscriptions;
    while (node) {
      node.subscription.dispose();
      node = node.next;
    }
  }
}

class AllKeyedProducer implements Producer<any, any> {
  constructor(public sources: Record<PropertyKey, any>) {}

  produce(sink: Sink<any>, dep: any) {
    const job = new AllKeyedJob(sink, dep);
    const sources = this.sources;
    const keys = Object.keys(sources);
    for (let index = 0; index < keys.length; index++) {
      const key = keys[index]!;
      job.next(key, sources[key]);
      if (job.initialized) {
        return job;
      }
    }
    const symbols = Object.getOwnPropertySymbols(sources);
    for (let index = 0; index < symbols.length; index++) {
      const symbol = symbols[index]!;
      if (!Object.prototype.propertyIsEnumerable.call(sources, symbol)) {
        continue;
      }
      job.next(symbol, sources[symbol]);
      if (job.initialized) {
        return job;
      }
    }
    if (job.pendingCount === 0) {
      sink.resolve(job.values);
      return;
    }
    job.initialized = true;
    return job;
  }
}

/**
 * The LazyPromise equivalent of `Promise.allKeyed`.
 */
export const allKeyed: {
  <const Sources extends object>(
    sources: Sources,
  ): [Sources] extends [LazyPromise<any, never>]
    ? never
    : LazyPromise<
        | NeverIfObjectContainsNever<{
            -readonly [Key in keyof Sources]: Exclude<
              Unbox<Sources[Key]>,
              ErrorBox<any>
            >;
          }>
        | Extract<Unbox<Sources[keyof Sources]>, ErrorBox<any>>,
        InferDep<Sources[keyof Sources]>
      >;
} = ((sources: object): any => {
  if (sources instanceof LazyPromise) {
    throw new Error(
      `A LazyPromise passed to allKeyed(...) must be wrapped in an object.`,
    );
  }
  return new LazyPromise(new AllKeyedProducer(sources));
}) as any;
