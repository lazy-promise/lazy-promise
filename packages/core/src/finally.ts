import type {
  Consumer,
  Job,
  Producer,
  Sink,
  Subscription,
} from "./lazyPromise.js";
import { ErrorBox, LazyPromise } from "./lazyPromise.js";
import { reportUnhandledError } from "./utils.js";

const emptySymbol = Symbol("empty");

class FinallyConsumerProducerJob
  implements Consumer<any>, Producer<any, any>, Job
{
  // The value that the source promise resolved to.
  value: any = emptySymbol;
  // The error that the source promise rejected with.
  error: unknown = emptySymbol;
  subscription: Subscription | undefined;

  constructor(
    public sink: Sink<any>,
    public callback: (dep: any) => any,
    public dep: any,
  ) {}

  resolve(value: any) {
    if (this.value !== emptySymbol) {
      this.sink.resolve(value instanceof ErrorBox ? value : this.value);
      return;
    }
    if (this.error !== emptySymbol) {
      if (value instanceof ErrorBox) {
        this.sink.resolve(value);
        return;
      }
      this.sink.reject(this.error);
      return;
    }
    this.value = value;
    this.sink.resolve(new LazyPromise(this));
  }

  reject(error: unknown) {
    if (this.value !== emptySymbol || this.error !== emptySymbol) {
      this.sink.reject(error);
      return;
    }
    this.error = error;
    this.sink.resolve(new LazyPromise(this));
  }

  produce(sink: Sink<any>, dep: any) {
    this.sink = sink;
    const callbackResult = (0, this.callback)(dep);
    if (callbackResult instanceof LazyPromise) {
      return callbackResult.subscribe<any>(this, dep);
    }
    this.resolve(callbackResult);
  }

  /**
   * Called on cancellation, and also before the settlement is passed on, in
   * which case the callback runs as the next producer instead.
   */
  dispose() {
    this.subscription?.dispose();
    if (this.value !== emptySymbol || this.error !== emptySymbol) {
      return;
    }
    // Canceled: the callback runs detached, its result is discarded.
    let callbackResult;
    try {
      callbackResult = (0, this.callback)(this.dep);
    } catch (error) {
      reportUnhandledError(error);
      return;
    }
    if (callbackResult instanceof LazyPromise) {
      callbackResult.subscribe<any>(undefined, this.dep);
    }
  }
}

export class FinallyProducer implements Producer<any, any> {
  constructor(
    public source: LazyPromise<any, any>,
    public callback: (dep: any) => any,
  ) {}

  produce(sink: Sink<any>, dep: any) {
    const job = new FinallyConsumerProducerJob(sink, this.callback, dep);
    job.subscription = this.source.subscribe<any>(job, dep);
    return job;
  }
}
