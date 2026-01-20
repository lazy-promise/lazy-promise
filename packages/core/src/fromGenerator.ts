import type { Yieldable } from "./lazyPromise";
import { LazyPromise } from "./lazyPromise";

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

    const handleResult = (result: IteratorResult<T, TReturn>) => {
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
    };

    const handleValue = (value: any) => {
      let result;
      try {
        result = generator.next(value as never);
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
