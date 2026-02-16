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
export const fromEager = <Value = never>(
  callback: (options: { readonly signal: AbortSignal }) => PromiseLike<Value>,
): LazyPromise<Value> =>
  new LazyPromise((resolve, reject) => {
    const options = new FromEagerOptions();
    let nativePromiseDisposed = false;
    let unsubscribe: (() => void) | undefined;
    // If the callback throws, we reject (it cannot be AbortError at this point).
    callback(options).then(
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
