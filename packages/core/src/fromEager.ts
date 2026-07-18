import type { Disposable, Producer, Sink, Unbox } from "./lazyPromise.js";
import { LazyPromise } from "./lazyPromise.js";

class FromEagerOptions {
  /** @internal */
  abortController?: AbortController;

  get signal() {
    if (!this.abortController) {
      this.abortController = new AbortController();
    }
    return this.abortController.signal;
  }
}

class FromEagerJob implements Disposable {
  options = new FromEagerOptions();

  dispose() {
    this.options.abortController?.abort(
      new DOMException(
        "The lazy promise subscription was disposed.",
        "AbortError",
      ),
    );
  }
}

class FromEagerProducer implements Producer<any> {
  constructor(
    public callback: (options: { readonly signal: AbortSignal }) => any,
  ) {}

  produce(sink: Sink<any>) {
    const job = new FromEagerJob();
    // May throw.
    const callbackReturn = (0, this.callback)(job.options);
    if (callbackReturn instanceof Promise) {
      callbackReturn.then(
        (value) => {
          sink.resolve(value);
        },
        (error) => {
          sink.reject(error);
        },
      );
      return job;
    }
    sink.resolve(callbackReturn);
  }
}

/**
 * Converts a Promise to a LazyPromise. The callback can use an AbortSignal
 * passed in the options object.
 */
export const fromEager = <Value>(
  callback: (options: { readonly signal: AbortSignal }) => Value,
): LazyPromise<
  Value extends Promise<infer PromiseValue> ? Unbox<PromiseValue> : Unbox<Value>
> => new LazyPromise<any>(new FromEagerProducer(callback));
