import type {
  Consumer,
  InferDep,
  Job,
  Producer,
  Sink,
  Subscription,
  Unbox,
  UnboxError,
  Yieldable,
} from "./lazyPromise.js";
import { ErrorBox, LazyPromise } from "./lazyPromise.js";
import type { NeverIfArrayContainsNever } from "./utils.js";

class AnyConsumer implements Consumer<any> {
  constructor(
    public index: number,
    // eslint-disable-next-line no-use-before-define
    public job: AnyJob,
  ) {}

  resolve(value: any) {
    const job = this.job;
    if (value instanceof ErrorBox) {
      job.errors[this.index] = value.error;
      if (job.initialized && job.pendingCount === 1) {
        job.sink.resolve(new ErrorBox(job.errors));
        // No need to unsubscribe since all sources that are promises have
        // resolved.
        return;
      }
      job.pendingCount--;
      return;
    }
    job.sink.resolve(value);
    job.initialized = true;
    job.dispose();
    return;
  }

  reject(error: unknown) {
    const job = this.job;
    job.sink.reject(error);
    job.initialized = true;
    job.dispose();
  }
}

class AnyJob implements Job {
  // A sparse array.
  errors: any[] = [];
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
        source.subscribe<any>(new AnyConsumer(index, this), this.dep),
      );
      return;
    }
    if (source instanceof ErrorBox) {
      this.errors[index] = source.error;
      return;
    }
    this.sink.resolve(source);
    this.initialized = true;
    this.dispose();
  }

  dispose() {
    for (let index = 0; index < this.subscriptions.length; index++) {
      this.subscriptions[index]!.dispose();
    }
  }
}

class AnyProducer implements Producer<any, any> {
  constructor(public sources: Iterable<any>) {}

  produce(sink: Sink<any>, dep: any) {
    const job = new AnyJob(sink, dep);
    let index = 0;
    for (const source of this.sources) {
      job.next(index, source);
      if (job.initialized) {
        return;
      }
      index++;
    }
    if (job.pendingCount === 0) {
      sink.resolve(new ErrorBox(job.errors));
      // No need to unsubscribe since all sources that are promises have
      // resolved.
      return;
    }
    job.initialized = true;
    return job;
  }
}

type ErrorBoxOrNever<Error> = Error extends never ? never : ErrorBox<Error>;

/**
 * Acts as `Promise.any` with respect to boxed errors.
 *
 * If one of the inputs resolves with a value other than a boxed error, the
 * resulting promise will immediately resolve with that value.
 *
 * If all inputs resolve with boxed errors, the resulting promise will resolve
 * with a boxed array of errors.
 *
 * If one of the inputs rejects, the resulting promise will immediately pass on
 * the untyped error.
 */
export const any: {
  <const Sources extends any[]>(
    sources: [...Sources],
  ): LazyPromise<
    | Exclude<Unbox<Sources[number]>, ErrorBox<any>>
    | ErrorBoxOrNever<
        NeverIfArrayContainsNever<{
          [Key in keyof Sources]: UnboxError<Unbox<Sources[Key]>>;
        }>
      >,
    InferDep<Sources[number]>
  >;
  <const Source>(
    sources: Iterable<Source>,
  ): [Source] extends [never]
    ? LazyPromise<ErrorBox<never[]>>
    : [Source] extends [Yieldable]
      ? undefined
      : LazyPromise<
          | Exclude<Unbox<Source>, ErrorBox<any>>
          | ErrorBox<UnboxError<Unbox<Source>>[]>,
          InferDep<Source>
        >;
} = (sources: Iterable<any>): any => {
  if (sources instanceof LazyPromise) {
    return;
  }
  return new LazyPromise(new AnyProducer(sources));
};
