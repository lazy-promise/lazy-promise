import { LazyPromise } from "./lazyPromise";

const abortControllerSymbol = Symbol("abortController");

// DOMException was only made a global in Node v17.0.0. We use this constant to
// support Node 16.
const DOMException =
  (globalThis as any).DOMException ??
  (() => {
    try {
      atob("~");
    } catch (err) {
      return Object.getPrototypeOf(err).constructor;
    }
  })();

const throwInMicrotask = (error: unknown) => {
  queueMicrotask(() => {
    throw error;
  });
};

class FromEagerOptions {
  [abortControllerSymbol]?: AbortController;

  get signal() {
    if (!this[abortControllerSymbol]) {
      this[abortControllerSymbol] = new AbortController();
    }
    return this[abortControllerSymbol].signal;
  }
}

/**
 * Converts a Promise to a LazyPromise. If the callback throws or the Promise it
 * returns rejects, the LazyPromise fails. If you would like it to reject
 * instead, redirect errors to the rejection channel using `catchFailure`:
 *
 * '''
 * // `fromEager` returns a `LazyPromise<..., never>`.
 * fromEager(...).pipe(
 *   // The resulting lazy will have type `LazyPromise<..., unknown>`.
 *   catchFailure(rejected),
 * );
 * '''
 *
 * The callback can use an AbortSignal passed in the options object.
 */
export const fromEager = <PromiseValue = never>(
  callback: (options: {
    readonly signal: AbortSignal;
  }) => PromiseLike<PromiseValue>,
): [PromiseValue] extends [never]
  ? LazyPromise<never, never>
  : LazyPromise<
      PromiseValue extends LazyPromise<infer Value, any> ? Value : PromiseValue,
      PromiseValue extends LazyPromise<any, infer Error> ? Error : never
    > =>
  new LazyPromise<any, any>((resolve, reject, fail) => {
    const options = new FromEagerOptions();
    let discardPromiseResult = false;
    let unsubscribe: (() => void) | undefined;
    // If the callback throws, we fail (it cannot be AbortError at this point).
    callback(options).then(
      (value) => {
        if (discardPromiseResult) {
          return;
        }
        if (value instanceof LazyPromise) {
          unsubscribe = value.subscribe(resolve, reject, fail);
          return;
        }
        resolve(value);
      },
      (error) => {
        if (discardPromiseResult) {
          if (!(error instanceof DOMException && error.name === "AbortError")) {
            throwInMicrotask(error);
          }
          return;
        }
        fail(error);
      },
    );
    return () => {
      if (unsubscribe) {
        unsubscribe();
        return;
      }
      discardPromiseResult = true;
      options[abortControllerSymbol]?.abort(
        new DOMException(
          "The lazy promise no longer has any subscribers.",
          "AbortError",
        ),
      );
    };
  }) as any;
