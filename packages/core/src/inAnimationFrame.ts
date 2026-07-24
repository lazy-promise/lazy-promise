import type { Disposable, Producer, Sink } from "./lazyPromise.js";
import { LazyPromise } from "./lazyPromise.js";

class InAnimationFrameJob implements Disposable {
  constructor(public id: ReturnType<typeof requestAnimationFrame>) {}

  dispose() {
    cancelAnimationFrame(this.id);
  }
}

class InAnimationFrameProducer implements Producer<DOMHighResTimeStamp> {
  produce(sink: Sink<DOMHighResTimeStamp>) {
    return new InAnimationFrameJob(
      requestAnimationFrame((timestamp) => {
        sink.resolve(timestamp);
      }),
    );
  }
}

/**
 * Returns a LazyPromise that resolves with `DOMHighResTimeStamp` in an
 * animation frame.
 */
export const inAnimationFrame = (): LazyPromise<DOMHighResTimeStamp> =>
  new LazyPromise(new InAnimationFrameProducer());
