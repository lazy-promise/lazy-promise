import type { LazyPromise } from "./lazyPromise";
import { createLazyPromise } from "./lazyPromise";

/**
 * Returns a lazy promise that resolves with `DOMHighResTimeStamp` in an
 * animation frame.
 */
export const animationFrame = (): LazyPromise<DOMHighResTimeStamp, never> =>
  createLazyPromise((resolve) => {
    const id = requestAnimationFrame(resolve);
    return () => {
      cancelAnimationFrame(id);
    };
  });
