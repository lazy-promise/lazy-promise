import type { Yieldable } from "./lazyPromise";
import { LazyPromise } from "./lazyPromise";

const emptySymbol = Symbol("empty");

export const fromGenerator = <
  T extends Yieldable<LazyPromise<any, any>>,
  TReturn,
>(
  generatorFunction: () => Generator<T, TReturn>,
): LazyPromise<
  TReturn extends LazyPromise<infer Value, any> ? Value : TReturn,
  | (TReturn extends LazyPromise<any, infer Error> ? Error : never)
  | (T extends Yieldable<LazyPromise<any, infer Error>> ? Error : never)
> =>
  new LazyPromise((resolve, reject, fail) => {
    const generator = generatorFunction();
    let unsubscribe: (() => void) | undefined;
    let lastValue: any = emptySymbol;

    const handleResult = (result: IteratorResult<T, TReturn>) => {
      while (true) {
        if (result.done) {
          if (result.value instanceof LazyPromise) {
            unsubscribe = result.value.subscribe(resolve, reject, fail);
            return;
          }
          resolve(result.value as any);
          return;
        }
        const source = result.value;
        // eslint-disable-next-line no-use-before-define
        unsubscribe = source.subscribe(handleValue, reject, fail);
        if (lastValue === emptySymbol) {
          return;
        }
        unsubscribe = undefined;
        try {
          result = generator.next(lastValue);
        } catch (error) {
          fail(error);
          return;
        }
      }
    };

    const handleValue = (value: any) => {
      // When possible, use the while loop to avoid increasing stack depth.
      if (!unsubscribe) {
        lastValue = value;
        return;
      }
      let result;
      try {
        result = generator.next(value);
      } catch (error) {
        fail(error);
        return;
      }
      handleResult(result);
    };

    handleResult(generator.next());

    return () => {
      unsubscribe?.();
    };
  });
