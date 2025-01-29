import type {
  LazyPromise,
  LazyPromiseError,
  LazyPromiseValue,
} from "./lazyPromise";
import { createLazyPromise } from "./lazyPromise";
import type { NeverIfContainsNever } from "./utils";

/**
 * The LazyPromise equivalent of `Promise.all`.
 */
export const all: {
  <Sources extends LazyPromise<unknown, unknown>[]>(sources: {
    [Key in keyof Sources]: Sources[Key];
  }): LazyPromise<
    NeverIfContainsNever<{
      [Key in keyof Sources]: LazyPromiseValue<Sources[Key]>;
    }>,
    LazyPromiseError<Sources[number]>
  >;
  <Value, Error>(
    sources: Iterable<LazyPromise<Value, Error>>,
  ): LazyPromise<Value[], Error>;
} = <Value, Error>(
  sources: Iterable<LazyPromise<Value, Error>>,
): LazyPromise<Value[], Error> =>
  createLazyPromise<Value[], Error>((resolve, reject, fail) => {
    // false means we haven't subscribed to all sources.
    let initialized = false;
    // A sparse array. undefined if the subscription was cancelled or the
    // promise has errored.
    let values: Value[] | undefined = [];
    const disposables: (() => void)[] = [];
    let resolvedCount = 0;
    // if initialized = true, i is the number of sources.
    let i = 0;
    for (const source of sources) {
      const sourceIndex = i;
      const dispose = source.subscribe(
        (value) => {
          if (values) {
            values[sourceIndex] = value;
            resolvedCount++;
            if (initialized && resolvedCount === i) {
              resolve(values);
            }
          }
        },
        (error) => {
          if (values) {
            values = undefined;
            reject(error);
            for (let j = 0; j < disposables.length; j++) {
              disposables[j]!();
            }
          }
        },
        () => {
          if (values) {
            values = undefined;
            fail();
            for (let j = 0; j < disposables.length; j++) {
              disposables[j]!();
            }
          }
        },
      );
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (!values) {
        dispose();
        return;
      }
      disposables.push(dispose);
      i++;
    }
    initialized = true;
    if (resolvedCount === i) {
      resolve(values);
    } else {
      return () => {
        values = undefined;
        for (let j = 0; j < disposables.length; j++) {
          disposables[j]!();
        }
      };
    }
  });
