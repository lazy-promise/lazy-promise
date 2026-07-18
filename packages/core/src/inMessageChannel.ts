import type { Producer, Sink } from "./lazyPromise.js";
import { LazyPromise } from "./lazyPromise.js";

const sinks: Sink<void>[] = [];

let channel: MessageChannel | undefined;

const createChannel = () => {
  channel = new MessageChannel();
  channel.port1.onmessage = () => {
    const sink = sinks.shift();
    sink!.resolve();
    if (sinks.length === 0) {
      (channel!.port1 as any).unref?.();
    }
  };
};

class InMessageChannelProducer implements Producer<void> {
  produce(sink: Sink<void>) {
    sinks.push(sink);
    if (!channel) {
      createChannel();
    }
    channel!.port2.postMessage(null);
    (channel!.port1 as any).ref?.();
  }
}

/**
 * Returns a lazy promise that posts a message in MessageChannel and resolves
 * with a value of type `void` when it receives the message back.
 *
 * To defer execution of a callback, use
 *
 * ```
 * inMessageChannel().map(() => ...)
 * ```
 *
 * To make an existing lazy promise settle via MessageChannel, pipe it though
 *
 * ```
 * .finalize(inMessageChannel)
 * ```
 *
 * To limit this to only when the promise resolves, use
 *
 * ```
 * map((value) => inMessageChannel().map(() => value))
 * ```
 */
export const inMessageChannel = (): LazyPromise<void> =>
  new LazyPromise(new InMessageChannelProducer());
