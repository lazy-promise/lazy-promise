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
import { reportUnhandledError } from "./utils.js";

const emptySymbol = Symbol("empty");

class FromGeneratorConsumerJob<TReturn> implements Consumer<any>, Job {
  // The value that a yielded promise resolved to.
  value: any = emptySymbol;
  // The error that a yielded promise rejected with.
  error: unknown = emptySymbol;
  // Set while waiting for a yielded promise that didn't settle synchronously.
  subscription: Subscription | undefined;
  disposed = false;
  // Set while the generator is running, so that a dispose from inside it is
  // acted upon once the generator has yielded.
  running = false;
  // Set once the generator has been told to return: from then on, whatever it
  // yields is waited for, but its result is discarded.
  unwinding = false;
  finished = false;

  constructor(
    public sink: Sink<any>,
    public generator: Generator<LazyPromise<any> & Yieldable, TReturn, any>,
    public dep: any,
  ) {}

  resolve(value: any) {
    this.value = value;
    if (this.subscription !== undefined) {
      this.subscription = undefined;
      this.run();
    }
  }

  reject(error: unknown) {
    this.error = error;
    if (this.subscription !== undefined) {
      this.subscription = undefined;
      this.run();
    }
  }

  /**
   * Runs the generator until it yields a promise that doesn't settle
   * synchronously, or finishes. A loop rather than recursion, so that a chain
   * of synchronously settling yields does not grow the stack.
   */
  run() {
    this.running = true;
    try {
      while (true) {
        let generatorResult: IteratorResult<
          LazyPromise<any> & Yieldable,
          TReturn | void
        >;
        if (this.disposed && !this.unwinding) {
          this.unwinding = true;
          // A settlement that arrived along with the dispose is moot.
          this.value = emptySymbol;
          this.error = emptySymbol;
          generatorResult = this.generator.return(undefined as any);
        } else if (this.error !== emptySymbol) {
          const error = this.error;
          this.error = emptySymbol;
          generatorResult = this.generator.throw(error);
        } else {
          const value = this.value;
          this.value = emptySymbol;
          generatorResult =
            value instanceof ErrorBox
              ? this.generator.return(value as any)
              : this.generator.next(value);
        }
        if (generatorResult.done) {
          this.finished = true;
          if (!this.unwinding) {
            this.sink.resolve(generatorResult.value);
          }
          return;
        }
        // Disposed from inside the generator: the yield it stopped at is where
        // it gets to return.
        if (this.disposed && !this.unwinding) {
          continue;
        }
        const subscription = generatorResult.value.subscribe<any>(
          this,
          this.dep,
        );
        // Disposed from inside the producer of the yielded promise.
        if (this.disposed && !this.unwinding) {
          subscription.dispose();
          continue;
        }
        if (this.value === emptySymbol && this.error === emptySymbol) {
          this.subscription = subscription;
          return;
        }
      }
    } catch (error) {
      this.finished = true;
      if (this.unwinding) {
        reportUnhandledError(error);
      } else {
        this.sink.reject(error);
      }
    } finally {
      this.running = false;
    }
  }

  dispose() {
    this.disposed = true;
    const subscription = this.subscription;
    if (subscription) {
      this.subscription = undefined;
      subscription.dispose();
    }
    if (!this.running && !this.finished) {
      this.run();
    }
  }
}

class FromGeneratorProducer<TReturn> implements Producer<any, any> {
  constructor(
    public generatorFunction: (dep: any) => Generator<any, TReturn>,
  ) {}

  produce(sink: Sink<any>, dep: any) {
    // This may throw and cause promise rejection.
    const generator = (0, this.generatorFunction)(dep);
    const job = new FromGeneratorConsumerJob(sink, generator, dep);
    job.run();
    return job;
  }
}

/**
 * Converts a generator function to a LazyPromise.
 */
export const fromGen = <
  TYield extends LazyPromise<any, any> & Yieldable = never,
  TReturn = void,
  ExtraDep = unknown,
>(
  generatorFunction: (dep: ExtraDep) => Generator<TYield, TReturn>,
): LazyPromise<
  // Not `Unbox<TYield | TReturn>` to make sure TS language service shows the
  // resolved type.
  Unbox<TYield> | Unbox<TReturn>,
  ExtraDep & InferDep<TYield | TReturn>
> => new LazyPromise<any>(new FromGeneratorProducer(generatorFunction));
