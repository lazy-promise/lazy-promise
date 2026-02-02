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
    let unsubscribe: (() => void) | undefined | typeof emptySymbol =
      emptySymbol;
    let resolveValue: unknown = emptySymbol;
    let rejectError: unknown = emptySymbol;
    let rejected = false;
    let failError: unknown = emptySymbol;

    const handleValue = (value: any) => {
      // When possible, use the while loop to avoid increasing stack depth.
      if (unsubscribe === emptySymbol) {
        resolveValue = value;
        return;
      }
      try {
        // eslint-disable-next-line no-use-before-define
        handleResult(generator.next(value));
      } catch (error) {
        fail(error);
        return;
      }
    };

    const handleRejection = (error: any) => {
      rejectError = error;
      // When possible, use the while loop to avoid increasing stack depth.
      if (unsubscribe === emptySymbol) {
        rejected = true;
        return;
      }
      try {
        // eslint-disable-next-line no-use-before-define
        handleResult((generator as Generator<TYield, void>).return());
      } catch (error) {
        fail(error);
        return;
      }
    };

    const handleFailure = (error: any) => {
      // When possible, use the while loop to avoid increasing stack depth.
      if (unsubscribe === emptySymbol) {
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
          unsubscribe = emptySymbol;
          result = generator.next(resolveValue);
          resolveValue = emptySymbol;
          continue;
        }
        if (rejected) {
          unsubscribe = emptySymbol;
          result = (generator as Generator<TYield, void>).return();
          rejected = false;
          continue;
        }
        if (failError !== emptySymbol) {
          unsubscribe = emptySymbol;
          result = (generator as Generator<TYield, void>).throw(failError);
          failError = emptySymbol;
          continue;
        }
        return;
      }
    };

    handleResult(generator.next());

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!unsubscribe) {
      return;
    }

    return () => {
      if (unsubscribe !== emptySymbol) {
        unsubscribe?.();
      }
    };
  });
