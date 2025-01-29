import type { LazyPromise } from "./lazyPromise";
import { createLazyPromise } from "./lazyPromise";

/**
 * The LazyPromise equivalent of `Promise.race`.
 */
export const race = <Value, Error>(
  sources: Iterable<LazyPromise<Value, Error>>,
): LazyPromise<Value, Error> =>
  createLazyPromise<Value, Error>((resolve, reject, fail) => {
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

    const handleError = (error: Error) => {
      if (!abort) {
        abort = true;
        reject(error);
        for (let i = 0; i < disposables.length; i++) {
          disposables[i]!();
        }
      }
    };

    const handleFailure = () => {
      if (!abort) {
        abort = true;
        fail();
        for (let i = 0; i < disposables.length; i++) {
          disposables[i]!();
        }
      }
    };

    for (const source of sources) {
      const dispose = source.subscribe(handleValue, handleError, handleFailure);
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (abort) {
        dispose();
        return;
      }
      disposables.push(dispose);
    }
    return () => {
      abort = true;
      for (let i = 0; i < disposables.length; i++) {
        disposables[i]!();
      }
    };
  });
