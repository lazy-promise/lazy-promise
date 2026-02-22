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
 * Converts a Promise to a LazyPromise. The callback can use an AbortSignal
 * passed in the options object.
 */
export const fromEager = <Value>(
  callback: (options: { readonly signal: AbortSignal }) => Value,
): LazyPromise<
  Value extends Promise<infer PromiseValue>
    ? PromiseValue extends LazyPromise<infer LazyPromiseValue>
      ? LazyPromiseValue
      : PromiseValue
    : Value extends LazyPromise<infer LazyPromiseValue>
      ? LazyPromiseValue
      : Value
> =>
  new LazyPromise<any>((resolve, reject) => {
    const options = new FromEagerOptions();
    let nativePromiseDisposed = false;
    let unsubscribe: (() => void) | undefined;
    // If the callback throws, we reject (it cannot be AbortError at this point).
    const callbackReturn = callback(options);
    if (!(callbackReturn instanceof Promise)) {
      resolve(callbackReturn);
      return;
    }
    callbackReturn.then(
      (value) => {
        if (nativePromiseDisposed) {
          return;
        }
        resolve(value);
      },
      (error) => {
        if (nativePromiseDisposed) {
          if (!(error instanceof DOMException && error.name === "AbortError")) {
            throwInMicrotask(error);
          }
          return;
        }
        reject(error);
      },
    );
    return () => {
      if (nativePromiseDisposed) {
        unsubscribe?.();
        return;
      }
      nativePromiseDisposed = true;
      options[abortControllerSymbol]?.abort(
        new DOMException(
          "The lazy promise no longer has any subscribers.",
          "AbortError",
        ),
      );
    };
  }) as any;
