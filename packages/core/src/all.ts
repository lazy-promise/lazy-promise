import type { LazyPromiseError, LazyPromiseValue } from "./lazyPromise";
import { LazyPromise, TypedError } from "./lazyPromise";
import type { NeverIfContainsNever } from "./utils";

type TypedErrorOrNever<Error> = Error extends never ? never : TypedError<Error>;

/**
 * The LazyPromise equivalent of `Promise.all`.
 */
export const all: {
  <Sources extends LazyPromise<any>[]>(
    sources: [...Sources],
  ): LazyPromise<
    | NeverIfContainsNever<{
        [Key in keyof Sources]: LazyPromiseValue<Sources[Key]>;
      }>
    | TypedErrorOrNever<LazyPromiseError<Sources[number]>>
  >;
  <Value = never, Error = never>(
    sources: Iterable<LazyPromise<Value | TypedError<Error>>>,
  ): LazyPromise<Value[] | TypedErrorOrNever<Error>>;
} = (sources: Iterable<LazyPromise<any>>): LazyPromise<any> =>
  new LazyPromise((resolve, reject) => {
    // false means we haven't subscribed to all sources.
    let initialized = false;
    // A sparse array.
    let values: any[] | undefined = [];
    const disposables: (() => void)[] = [];
    let resolvedCount = 0;
    // if initialized = true, i is the number of sources.
    let i = 0;
    for (const source of sources) {
      const sourceIndex = i;
      const unsubscribe = source.subscribe(
        (value) => {
          if (values) {
            if (value instanceof TypedError) {
              values = undefined;
              resolve(value);
              for (let j = 0; j < disposables.length; j++) {
                disposables[j]!();
              }
              return;
            }
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
      );
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (!values) {
        unsubscribe?.();
        return;
      }
      if (unsubscribe) {
        disposables.push(unsubscribe);
      }
      i++;
    }
    initialized = true;
    if (resolvedCount === i) {
      resolve(values);
      return;
    }
    if (disposables.length) {
      return () => {
        values = undefined;
        for (let j = 0; j < disposables.length; j++) {
          disposables[j]!();
        }
      };
    }
  });
