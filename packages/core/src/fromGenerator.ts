import type { Yieldable } from "./lazyPromise";
import { LazyPromise } from "./lazyPromise";

const emptySymbol = Symbol("empty");

/**
 * Converts a generator function to a LazyPromise.
 */
export const fromGenerator = <
  TYield extends Yieldable<LazyPromise<any, any>>,
  TReturn,
>(
  generatorFunction: () => Generator<TYield, TReturn>,
): LazyPromise<
  TReturn,
  TYield extends Yieldable<LazyPromise<any, infer Error>> ? Error : never
> =>
  new LazyPromise<any, any>((resolve, reject, fail) => {
    const generator = generatorFunction();
    let unsubscribe: (() => void) | undefined;
    let resolveValue: unknown = emptySymbol;
    let rejectError: unknown = emptySymbol;
    let failError: unknown = emptySymbol;

    const handleValue = (value: any) => {
      // When possible, use the while loop to avoid increasing stack depth.
      if (!unsubscribe) {
        resolveValue = value;
        return;
      }
      let result;
      try {
        result = generator.next(value);
      } catch (error) {
        fail(error);
        return;
      }
      // eslint-disable-next-line no-use-before-define
      handleResult(result);
    };

    const handleRejection = (error: any) => {
      // When possible, use the while loop to avoid increasing stack depth.
      if (!unsubscribe) {
        rejectError = error;
        return;
      }
      let result;
      try {
        result = (generator as Generator<TYield, void>).return();
      } catch (error) {
        fail(error);
        return;
      }
      rejectError = error;
      // eslint-disable-next-line no-use-before-define
      handleResult(result);
    };

    const handleFailure = (error: any) => {
      // When possible, use the while loop to avoid increasing stack depth.
      if (!unsubscribe) {
        failError = error;
        return;
      }
      let result;
      try {
        result = (generator as Generator<TYield, void>).throw(error);
      } catch (error) {
        fail(error);
        return;
      }
      // eslint-disable-next-line no-use-before-define
      handleResult(result);
    };

    const handleResult = (result: IteratorResult<TYield, TReturn | void>) => {
      while (true) {
        if (result.done) {
          if (rejectError !== emptySymbol) {
            reject(rejectError);
            return;
          }
          resolve(result.value as any);
          return;
        }
        const source = result.value;
        unsubscribe = source.subscribe(
          handleValue,
          handleRejection,
          handleFailure,
        );
        if (resolveValue !== emptySymbol) {
          unsubscribe = undefined;
          try {
            result = generator.next(resolveValue);
          } catch (error) {
            fail(error);
            return;
          }
          resolveValue = emptySymbol;
          continue;
        }
        if (failError !== emptySymbol) {
          unsubscribe = undefined;
          try {
            result = (generator as Generator<TYield, void>).throw(failError);
          } catch (error) {
            fail(error);
            return;
          }
          failError = emptySymbol;
          continue;
        }
        // This comes last because we want to check for rejectError only if
        // resolveValue and failError are empty.
        if (rejectError !== emptySymbol) {
          unsubscribe = undefined;
          try {
            result = (generator as Generator<TYield, void>).return();
          } catch (error) {
            fail(error);
            return;
          }
          continue;
        }
        return;
      }
    };

    handleResult(generator.next());

    return () => {
      // In this case we don't run `finally {...}`.
      unsubscribe?.();
    };
  });
