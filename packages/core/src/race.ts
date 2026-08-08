import type {
  Consumer,
  InferDep,
  Job,
  Producer,
  Sink,
  Subscription,
  Unbox,
} from "./lazyPromise.js";
import { LazyPromise } from "./lazyPromise.js";

class RaceConsumerJob implements Consumer<any>, Job {
  subscriptions: Subscription[] = [];
  settled = false;

  constructor(public sink: Sink<any>) {}

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
    for (let index = 0; index < this.subscriptions.length; index++) {
      this.subscriptions[index]!.dispose();
    }
  }
}

class RaceProducer implements Producer<any, any> {
  constructor(public sources: Iterable<any>) {}

  produce(sink: Sink<any>, dep: any) {
    const job = new RaceConsumerJob(sink);
    for (const source of this.sources) {
      if (source instanceof LazyPromise) {
        job.subscriptions.push(source.subscribe<any>(job, dep));
        if (job.settled) {
          return;
        }
        continue;
      }
      sink.resolve(source);
      job.dispose();
      return;
    }
    return job;
  }
}

/**
 * The LazyPromise equivalent of `Promise.race`.
 */
export const race = <Source>(
  sources: Iterable<Source>,
): LazyPromise<Unbox<Source>, InferDep<Source>> =>
  new LazyPromise(new RaceProducer(sources));
