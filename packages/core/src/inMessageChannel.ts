import type { InnerSubscriber, Producer } from "./lazyPromise";
import { LazyPromise } from "./lazyPromise";

const subscribers: InnerSubscriber<void>[] = [];

let channel: MessageChannel | undefined;

const createChannel = () => {
  channel = new MessageChannel();
  channel.port1.onmessage = () => {
    const subscriber = subscribers.shift();
    subscriber!.resolve();
    if (subscribers.length === 0) {
      (channel!.port1 as any).unref?.();
    }
  };
};

class InMessageChannelProducer implements Producer<void> {
  produce(innerSubscriber: InnerSubscriber<void>) {
    subscribers.push(innerSubscriber);
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
 * To make an existing lazy promise settle via MessageChannel, pipe it though
 *
 * ```
 * finalize(inMessageChannel)
 * ```
 *
 * To limit this to only when the promise resolves, use
 *
 * ```
 * map((value) => inMessageChannel().pipe(map(() => value)))
 * ```
 */
export const inMessageChannel = (): LazyPromise<void> =>
  new LazyPromise(new InMessageChannelProducer());
