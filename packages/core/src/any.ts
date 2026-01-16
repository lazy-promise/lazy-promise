import type { LazyPromiseError, LazyPromiseValue } from "./lazyPromise";
import { LazyPromise } from "./lazyPromise";
import type { NeverIfContainsNever } from "./utils";

/**
 * The LazyPromise equivalent of `Promise.any`. If all sources reject, rejects
 * with an array of errors. If one source fails, fails, passing on the error.
 */
export const any: {
  <Sources extends LazyPromise<unknown, unknown>[]>(sources: {
    [Key in keyof Sources]: Sources[Key];
  }): LazyPromise<
    LazyPromiseValue<Sources[number]>,
    NeverIfContainsNever<{
      [Key in keyof Sources]: LazyPromiseError<Sources[Key]>;
    }>
  >;
  <Value, Error>(
    sources: Iterable<LazyPromise<Value, Error>>,
  ): LazyPromise<Value, Error[]>;
} = <Value, Error>(
  sources: Iterable<LazyPromise<Value, Error>>,
): LazyPromise<Value, Error[]> =>
  new LazyPromise<Value, Error[]>((resolve, reject, fail) => {
    // false means we haven't subscribed to all sources.
    let initialized = false;
    // A sparse array. undefined if the subscription was cancelled or the
    // promise has resolved.
    let errors: Error[] | undefined = [];
    const disposables: (() => void)[] = [];
    let rejectedCount = 0;
    // if initialized = true, i is the number of sources.
    let i = 0;
    for (const source of sources) {
      const sourceIndex = i;
      const dispose = source.subscribe(
        (value) => {
          if (errors) {
            errors = undefined;
            resolve(value);
            for (let j = 0; j < disposables.length; j++) {
              disposables[j]!();
            }
          }
        },
        (error) => {
          if (errors) {
            errors[sourceIndex] = error;
            rejectedCount++;
            if (initialized && rejectedCount === i) {
              reject(errors);
            }
          }
        },
        (error) => {
          if (errors) {
            errors = undefined;
            fail(error);
            for (let j = 0; j < disposables.length; j++) {
              disposables[j]!();
            }
          }
        },
      );
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (!errors) {
        dispose();
        return;
      }
      disposables.push(dispose);
      i++;
    }
    initialized = true;
    if (rejectedCount === i) {
      reject(errors);
    } else {
      return () => {
        errors = undefined;
        for (let j = 0; j < disposables.length; j++) {
          disposables[j]!();
        }
      };
    }
  });
