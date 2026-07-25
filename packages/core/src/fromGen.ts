import type {
  Consumer,
  Disposable,
  Producer,
  Sink,
  Unbox,
  Yieldable,
} from "./lazyPromise.js";
import { ErrorBox, LazyPromise } from "./lazyPromise.js";

const emptySymbol = Symbol("empty");

class FromGeneratorConsumerJob<TReturn> implements Consumer<any>, Disposable {
  // The value that a yielded promise resolved to.
  value: any = emptySymbol;
  // The error that a yielded promise rejected with.
  error: unknown = emptySymbol;
  subscription: Disposable | undefined;
  disposed = false;

  constructor(
    public sink: Sink<any>,
    public generator: Generator<LazyPromise<any> & Yieldable, TReturn, any>,
  ) {}

  resolve(value: any) {
    // When possible, use the while loop to avoid increasing stack depth.
    if (this.subscription === undefined) {
      this.value = value;
      return;
    }
    try {
      // May throw.
      const generatorResult =
        value instanceof ErrorBox
          ? this.generator.return(value as any)
          : this.generator.next(value);
      if (this.disposed) {
        return;
      }
      this.subscription = undefined;
      // May throw.
      this.next(generatorResult);
    } catch (error) {
      this.sink.reject(error);
    }
  }

  reject(error: unknown) {
    // When possible, use the while loop to avoid increasing stack depth.
    if (this.subscription === undefined) {
      this.error = error;
      return;
    }
    try {
      // May throw.
      const generatorResult = this.generator.throw(error);
      if (this.disposed) {
        return;
      }
      this.subscription = undefined;
      // May throw.
      this.next(generatorResult);
    } catch (error) {
      this.sink.reject(error);
    }
  }

  // May throw.
  next(
    generatorResult: IteratorResult<
      LazyPromise<any> & Yieldable,
      TReturn | void
    >,
  ) {
    while (true) {
      if (generatorResult.done) {
        this.sink.resolve(generatorResult.value);
        return;
      }
      const subscription = generatorResult.value.subscribe<any>(this);
      if (this.disposed) {
        subscription.dispose();
        return;
      }
      if (this.value !== emptySymbol) {
        // May throw.
        generatorResult =
          this.value instanceof ErrorBox
            ? this.generator.return(this.value as any)
            : this.generator.next(this.value);
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (this.disposed) {
          return;
        }
        this.subscription = undefined;
        this.value = emptySymbol;
        continue;
      }
      if (this.error !== emptySymbol) {
        // May throw.
        generatorResult = this.generator.throw(this.error);
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (this.disposed) {
          return;
        }
        this.subscription = undefined;
        this.error = emptySymbol;
        continue;
      }
      this.subscription = subscription;
      return;
    }
  }

  dispose() {
    this.disposed = true;
    this.subscription?.dispose();
  }
}

class FromGeneratorProducer<TReturn> implements Producer<any> {
  constructor(public generatorFunction: () => Generator<any, TReturn>) {}

  produce(sink: Sink<any>) {
    // This may throw and cause promise rejection.
    const generator = (0, this.generatorFunction)();
    const job = new FromGeneratorConsumerJob(sink, generator);
    // This may throw and cause promise rejection.
    job.next(
      // This may throw and cause promise rejection.
      generator.next(),
    );
    return job;
  }
}

/**
 * Converts a generator function to a LazyPromise.
 */
export const fromGen = <
  TYield extends LazyPromise<any> & Yieldable = never,
  TReturn = void,
>(
  generatorFunction: () => Generator<TYield, TReturn>,
): LazyPromise<Unbox<TReturn | TYield>> =>
  new LazyPromise<any>(new FromGeneratorProducer(generatorFunction));
