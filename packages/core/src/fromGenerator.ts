import type { Yieldable } from "./lazyPromise";
import { LazyPromise } from "./lazyPromise";

const emptySymbol = Symbol("empty");

/**
 * Converts a generator function to a LazyPromise.
 */
export const fromGenerator = <TReturn>(
  generatorFunction: () => Generator<Yieldable<LazyPromise<any>>, TReturn>,
): LazyPromise<TReturn> =>
  new LazyPromise<any>((resolve, reject) => {
    const generator = generatorFunction();
    let unsubscribe: (() => void) | undefined | typeof emptySymbol =
      emptySymbol;
    let resolveValue: unknown = emptySymbol;
    let rejectError: unknown = emptySymbol;

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
        reject(error);
        return;
      }
    };

    const handleError = (error: any) => {
      // When possible, use the while loop to avoid increasing stack depth.
      if (unsubscribe === emptySymbol) {
        rejectError = error;
        return;
      }
      let result;
      try {
        result = generator.throw(error);
      } catch (error) {
        reject(error);
        return;
      }
      // eslint-disable-next-line no-use-before-define
      handleResult(result);
    };

    const handleResult = (
      result: IteratorResult<Yieldable<LazyPromise<any>>, TReturn | void>,
    ) => {
      while (true) {
        if (result.done) {
          resolve(result.value as any);
          return;
        }
        const source = result.value;
        unsubscribe = source.subscribe(handleValue, handleError);
        if (resolveValue !== emptySymbol) {
          unsubscribe = emptySymbol;
          result = generator.next(resolveValue);
          resolveValue = emptySymbol;
          continue;
        }
        if (rejectError !== emptySymbol) {
          unsubscribe = emptySymbol;
          result = generator.throw(rejectError);
          rejectError = emptySymbol;
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
