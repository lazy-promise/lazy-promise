import { LazyPromise } from "./lazyPromise";

/**
 * Returns a lazy promise that resolves with `DOMHighResTimeStamp` in an
 * animation frame.
 */
export const inAnimationFrame = (): LazyPromise<DOMHighResTimeStamp, never> =>
  new LazyPromise((resolve) => {
    const id = requestAnimationFrame(resolve);
    return () => {
      cancelAnimationFrame(id);
    };
  });
