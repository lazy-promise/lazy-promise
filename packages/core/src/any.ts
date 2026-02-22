import type { LazyPromiseError, LazyPromiseValue } from "./lazyPromise";
import { LazyPromise, TypedError } from "./lazyPromise";
import type { NeverIfContainsNever } from "./utils";

type TypedErrorOrNever<Error> = Error extends never ? never : TypedError<Error>;

/**
 * Acts as `Promise.any` with respect to typed errors. If all sources resolve
 * with a typed error, resolves with a typed error wrapping an array of
 * unwrapped errors. If any of the sources rejects with an untyped error,
 * rejects with that error.
 */
export const any: {
  <Sources extends LazyPromise<any>[]>(
    sources: [...Sources],
  ): LazyPromise<
    | LazyPromiseValue<Sources[number]>
    | TypedErrorOrNever<
        NeverIfContainsNever<{
          [Key in keyof Sources]: LazyPromiseError<Sources[Key]>;
        }>
      >
  >;
  <Value = never, Error = never>(
    sources: Iterable<LazyPromise<Value | TypedError<Error>>>,
  ): LazyPromise<
    Value | TypedErrorOrNever<Error extends never ? never : Error[]>
  >;
} = (sources: Iterable<LazyPromise<any>>): LazyPromise<any> =>
  new LazyPromise((resolve, reject) => {
    // false means we haven't subscribed to all sources.
    let initialized = false;
    // A sparse array.
    let errors: any[] | undefined = [];
    const disposables: (() => void)[] = [];
    let errorCount = 0;
    // if initialized = true, i is the number of sources.
    let i = 0;
    for (const source of sources) {
      const sourceIndex = i;
      const unsubscribe = source.subscribe(
        (value) => {
          if (errors) {
            if (value instanceof TypedError) {
              errors[sourceIndex] = value.error;
              errorCount++;
              if (initialized && errorCount === i) {
                resolve(new TypedError(errors));
              }
              return;
            }
            errors = undefined;
            resolve(value);
            for (let j = 0; j < disposables.length; j++) {
              disposables[j]!();
            }
          }
        },
        (error) => {
          if (errors) {
            errors = undefined;
            reject(error);
            for (let j = 0; j < disposables.length; j++) {
              disposables[j]!();
            }
          }
        },
      );
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (!errors) {
        unsubscribe?.();
        return;
      }
      if (unsubscribe) {
        disposables.push(unsubscribe);
      }
      i++;
    }
    initialized = true;
    if (errorCount === i) {
      resolve(new TypedError(errors));
      return;
    }
    if (disposables.length) {
      return () => {
        errors = undefined;
        for (let j = 0; j < disposables.length; j++) {
          disposables[j]!();
        }
      };
    }
  });
