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
import { ErrorBox, LazyPromise } from "./lazyPromise.js";
import type { NeverIfArrayContainsNever } from "./utils.js";

class AllConsumer implements Consumer<any> {
  constructor(
    public index: number,
    // eslint-disable-next-line no-use-before-define
    public job: AllJob,
  ) {}

  resolve(value: any) {
    const job = this.job;
    if (value instanceof ErrorBox) {
      job.sink.resolve(value);
      job.initialized = true;
      job.dispose();
      return;
    }
    job.values[this.index] = value;
    if (job.initialized && job.pendingCount === 1) {
      job.sink.resolve(job.values);
      // No need to unsubscribe since all sources that are promises have
      // resolved.
      return;
    }
    job.pendingCount--;
  }

  reject(error: unknown) {
    const job = this.job;
    job.sink.reject(error);
    job.initialized = true;
    job.dispose();
  }
}

class AllJob implements Job {
  // A sparse array.
  values: any[] = [];
  subscriptions: Subscription[] = [];
  pendingCount = 0;
  initialized = false;

  constructor(
    public sink: Sink<any>,
    public dep: any,
  ) {}

  next(index: number, source: any) {
    if (source instanceof LazyPromise) {
      this.pendingCount++;
      this.subscriptions.push(
        source.subscribe<any>(new AllConsumer(index, this), this.dep),
      );
      return;
    }
    if (source instanceof ErrorBox) {
      this.sink.resolve(source);
      this.initialized = true;
      this.dispose();
      return;
    }
    this.values[index] = source;
  }

  dispose() {
    for (let index = 0; index < this.subscriptions.length; index++) {
      this.subscriptions[index]!.dispose();
    }
  }
}

class AllProducer implements Producer<any, any> {
  constructor(public sources: Iterable<any>) {}

  produce(sink: Sink<any>, dep: any) {
    const job = new AllJob(sink, dep);
    let index = 0;
    for (const source of this.sources) {
      job.next(index, source);
      if (job.initialized) {
        return;
      }
      index++;
    }
    if (job.pendingCount === 0) {
      sink.resolve(job.values);
      // No need to unsubscribe since all sources that are promises have
      // resolved.
      return;
    }
    job.initialized = true;
    return job;
  }
}

/**
 * The LazyPromise equivalent of `Promise.all`.
 */
export const all: {
  <const Sources extends any[]>(
    sources: [...Sources],
  ): LazyPromise<
    | NeverIfArrayContainsNever<{
        [Key in keyof Sources]: Exclude<Unbox<Sources[Key]>, ErrorBox<any>>;
      }>
    | Extract<Unbox<Sources[number]>, ErrorBox<any>>,
    InferDep<Sources[number]>
  >;
  <const Source>(
    sources: Iterable<Source>,
  ): [Source] extends [never]
    ? LazyPromise<never[]>
    : [Source] extends [Yieldable]
      ? never
      : LazyPromise<
          | Exclude<Unbox<Source>, ErrorBox<any>>[]
          | Extract<Unbox<Source>, ErrorBox<any>>,
          InferDep<Source>
        >;
} = ((sources: Iterable<any>): any => {
  if (sources instanceof LazyPromise) {
    throw new Error(
      `A LazyPromise passed to all(...) must be wrapped in an Iterable such as an array.`,
    );
  }
  return new LazyPromise(new AllProducer(sources));
}) as any;
