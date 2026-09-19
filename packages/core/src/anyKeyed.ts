import type {
  Consumer,
  InferDep,
  Job,
  Producer,
  Sink,
  Subscription,
  Unbox,
  UnboxError,
} from "./lazyPromise.js";
import { ErrorBox, LazyPromise } from "./lazyPromise.js";
import type { ErrorBoxOrNever, NeverIfObjectContainsNever } from "./utils.js";

interface SubscriptionNode {
  subscription: Subscription;
  next: SubscriptionNode | undefined;
}

class AnyKeyedConsumer implements Consumer<any> {
  constructor(
    public key: PropertyKey,
    // eslint-disable-next-line no-use-before-define
    public job: AnyKeyedJob,
  ) {}

  resolve(value: any) {
    const job = this.job;
    if (value instanceof ErrorBox) {
      job.errors[this.key] = value.error;
      if (job.initialized && job.pendingCount === 1) {
        job.sink.resolve(new ErrorBox(job.errors));
        return;
      }
      job.pendingCount--;
      return;
    }
    job.initialized = true;
    job.sink.resolve(value);
  }

  reject(error: unknown) {
    const job = this.job;
    job.initialized = true;
    job.sink.reject(error);
  }
}

class AnyKeyedJob implements Job {
  errors: Record<PropertyKey, any> = { __proto__: null };
  subscriptions?: SubscriptionNode;
  pendingCount = 0;
  initialized = false;

  constructor(
    public sink: Sink<any>,
    public dep: any,
  ) {}

  next(key: PropertyKey, source: any) {
    if (source instanceof LazyPromise) {
      // Reserves the key so the errors object keeps source key order.
      this.errors[key] = undefined;
      this.pendingCount++;
      const subscription = source.subscribe<any>(
        new AnyKeyedConsumer(key, this),
        this.dep,
      );
      if (this.initialized) {
        return;
      }
      this.subscriptions = { subscription, next: this.subscriptions };
      return;
    }
    if (source instanceof ErrorBox) {
      this.errors[key] = source.error;
      return;
    }
    this.initialized = true;
    this.sink.resolve(source);
  }

  dispose() {
    let node = this.subscriptions;
    while (node) {
      node.subscription.dispose();
      node = node.next;
    }
  }
}

class AnyKeyedProducer implements Producer<any, any> {
  constructor(public sources: Record<PropertyKey, any>) {}

  produce(sink: Sink<any>, dep: any) {
    const job = new AnyKeyedJob(sink, dep);
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
      sink.resolve(new ErrorBox(job.errors));
      return;
    }
    job.initialized = true;
    return job;
  }
}

/**
 * The keyed counterpart of `any`: acts as `allKeyed` with respect to boxed
 * errors.
 *
 * If one of the inputs resolves with a value other than a boxed error, the
 * resulting promise will immediately resolve with that value.
 *
 * If all inputs resolve with boxed errors, the resulting promise will resolve
 * with a boxed null-prototype object of errors keyed like the input.
 *
 * If one of the inputs rejects, the resulting promise will immediately pass on
 * the untyped error.
 */
export const anyKeyed: {
  <const Sources extends object>(
    sources: Sources,
  ): [Sources] extends [LazyPromise<any, never>]
    ? never
    : LazyPromise<
        | Exclude<Unbox<Sources[keyof Sources]>, ErrorBox<any>>
        | ErrorBoxOrNever<
            NeverIfObjectContainsNever<{
              -readonly [Key in keyof Sources]: UnboxError<Unbox<Sources[Key]>>;
            }>
          >,
        InferDep<Sources[keyof Sources]>
      >;
} = ((sources: object): any => {
  if (sources instanceof LazyPromise) {
    throw new Error(
      `A LazyPromise passed to anyKeyed(...) must be wrapped in an object.`,
    );
  }
  return new LazyPromise(new AnyKeyedProducer(sources));
}) as any;
