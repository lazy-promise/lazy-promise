import type {
  Consumer,
  Disposable,
  InferDep,
  Producer,
  Sink,
  Unbox,
} from "./lazyPromise.js";
import { ErrorBox, LazyPromise } from "./lazyPromise.js";
import type {
  NeverIfArrayContainsNever,
  NeverIfRecordContainsNever,
} from "./utils.js";

class AllConsumer implements Consumer<any> {
  constructor(
    public key: any,
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
    job.values[this.key] = value;
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

class AllJob implements Disposable {
  // A sparse array or an object.
  values: any;
  subscriptions: Disposable[] = [];
  pendingCount = 0;
  initialized = false;

  constructor(
    public sink: Sink<any>,
    public dep: any,
  ) {}

  next(key: any, source: any) {
    if (source instanceof LazyPromise) {
      this.pendingCount++;
      this.subscriptions.push(
        source.subscribe<any>(new AllConsumer(key, this), this.dep),
      );
      return;
    }
    if (source instanceof ErrorBox) {
      this.sink.resolve(source);
      this.initialized = true;
      this.dispose();
      return;
    }
    this.values[key] = source;
  }

  dispose() {
    for (let index = 0; index < this.subscriptions.length; index++) {
      this.subscriptions[index]!.dispose();
    }
  }
}

class AllProducer implements Producer<any, any> {
  constructor(public sources: Iterable<any> | Record<any, any>) {}

  produce(sink: Sink<any>, dep: any) {
    const job = new AllJob(sink, dep);
    if (Symbol.iterator in this.sources) {
      job.values = [];
      let index = 0;
      for (const source of this.sources) {
        job.next(index, source);
        if (job.initialized) {
          return;
        }
        index++;
      }
    } else {
      job.values = {};
      for (const key in this.sources) {
        job.next(key, this.sources[key]);
        if (job.initialized) {
          return;
        }
      }
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
 * The LazyPromise equivalent of `Promise.all`. In addition to an iterable,
 * accepts inputs in the form of a plain object (in that case a successful
 * result is an object with the same keys).
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
  <const Source = never>(
    sources: Iterable<Source>,
  ): LazyPromise<
    | Exclude<Unbox<Source>, ErrorBox<any>>[]
    | Extract<Unbox<Source>, ErrorBox<any>>,
    InferDep<Source>
  >;
  <const Sources extends Record<any, any>>(
    sources: Sources,
  ): LazyPromise<
    | NeverIfRecordContainsNever<{
        [Key in keyof Sources]: Exclude<Unbox<Sources[Key]>, ErrorBox<any>>;
      }>
    | Extract<Unbox<Sources[keyof Sources]>, ErrorBox<any>>,
    InferDep<Sources[keyof Sources]>
  >;
} = (sources: Iterable<any> | Record<any, any>): LazyPromise<any> =>
  new LazyPromise(new AllProducer(sources));
