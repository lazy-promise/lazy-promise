import type { LazyPromise } from "./lazyPromise";
import { createLazyPromise } from "./lazyPromise";

/**
 * The LazyPromise equivalent of Promise.race.
 */
export const race = <Value, Error>(
  sources: Iterable<LazyPromise<Value, Error>>,
): LazyPromise<Value, Error> =>
  createLazyPromise<Value, Error>((resolve, reject) => {
    let settledOrCancelled = false;
    const disposables: (() => void)[] = [];
    for (const source of sources) {
      const dispose = source.subscribe(
        (value) => {
          if (!settledOrCancelled) {
            settledOrCancelled = true;
            resolve(value);
            for (let i = 0; i < disposables.length; i++) {
              disposables[i]!();
            }
          }
        },
        (error) => {
          if (!settledOrCancelled) {
            settledOrCancelled = true;
            reject(error);
            for (let i = 0; i < disposables.length; i++) {
              disposables[i]!();
            }
          }
        },
      );
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (settledOrCancelled) {
        dispose();
        return;
      }
      disposables.push(dispose);
    }
    return () => {
      settledOrCancelled = true;
      for (let i = 0; i < disposables.length; i++) {
        disposables[i]!();
      }
    };
  });
