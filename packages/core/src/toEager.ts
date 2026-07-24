import type { Consumer, Disposable } from "./lazyPromise.js";

export class ToEagerConsumerListener
  implements Consumer<any>, EventListenerObject
{
  subscription?: Disposable;
  settled = false;

  constructor(
    public resolveNative: (value: any) => void,
    public rejectNative: (error: unknown) => void,
    public signal: AbortSignal,
  ) {}

  resolve(value: any) {
    this.settled = true;
    this.signal.removeEventListener("abort", this);
    this.resolveNative(value);
  }

  reject(error: unknown) {
    this.settled = true;
    this.signal.removeEventListener("abort", this);
    this.rejectNative(error);
  }

  handleEvent() {
    this.signal.removeEventListener("abort", this);
    this.subscription!.dispose();
    this.rejectNative(this.signal.reason);
  }
}
