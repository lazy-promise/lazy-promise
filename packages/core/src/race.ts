import type {
  Consumer,
  Disposable,
  Producer,
  Sink,
  Unbox,
} from "./lazyPromise.js";
import { LazyPromise } from "./lazyPromise.js";

class RaceConsumerJob implements Consumer<any>, Disposable {
  subscriptions: Disposable[] = [];
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

class RaceProducer implements Producer<any> {
  constructor(public sources: Iterable<any>) {}

  produce(sink: Sink<any>) {
    const job = new RaceConsumerJob(sink);
    for (const source of this.sources) {
      if (source instanceof LazyPromise) {
        job.subscriptions.push(source.subscribe(job));
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
): LazyPromise<Unbox<Source>> => new LazyPromise(new RaceProducer(sources));
