import { LazyPromise } from "./lazyPromise";

/**
 * The LazyPromise equivalent of `Promise.race`.
 */
export const race = <Value, Error>(
  sources: Iterable<LazyPromise<Value, Error>>,
): LazyPromise<Value, Error> =>
  new LazyPromise<Value, Error>((resolve, reject, fail) => {
    let abort = false;
    const disposables: (() => void)[] = [];

    const handleValue = (value: Value) => {
      if (!abort) {
        abort = true;
        resolve(value);
        for (let i = 0; i < disposables.length; i++) {
          disposables[i]!();
        }
      }
    };

    const handleRejection = (error: Error) => {
      if (!abort) {
        abort = true;
        reject(error);
        for (let i = 0; i < disposables.length; i++) {
          disposables[i]!();
        }
      }
    };

    const handleFailure = (error: unknown) => {
      if (!abort) {
        abort = true;
        fail(error);
        for (let i = 0; i < disposables.length; i++) {
          disposables[i]!();
        }
      }
    };

    for (const source of sources) {
      const unsubscribe = source.subscribe(
        handleValue,
        handleRejection,
        handleFailure,
      );
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (abort) {
        unsubscribe?.();
        return;
      }
      if (unsubscribe) {
        disposables.push(unsubscribe);
      }
    }
    if (disposables.length) {
      return () => {
        abort = true;
        for (let i = 0; i < disposables.length; i++) {
          disposables[i]!();
        }
      };
    }
  });
