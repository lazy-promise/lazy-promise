import type { InnerSubscriber, Subscriber } from "@lazy-promise/core";
import { LazyPromise, never } from "@lazy-promise/core";
import { test } from "vitest";

const gc = () =>
  new Promise((resolve, reject) => {
    setTimeout(() => {
      if (!global.gc) {
        reject(new Error("gc not enabled"));
        return;
      }
      global.gc();
      resolve(undefined);
    }, 0);
  });

const gcMaxAttempts = 10;

const expectCollected = async (ref: WeakRef<object>) => {
  let attempts = 0;
  while (attempts <= gcMaxAttempts) {
    attempts++;
    await gc();
    if (ref.deref() === undefined) {
      return;
    }
  }
  throw new Error("Expected to be garbage collected but wasn't.");
};

const expectNotCollected = async (ref: WeakRef<object>) => {
  let attempts = 0;
  while (attempts <= gcMaxAttempts) {
    attempts++;
    await gc();
    if (ref.deref() === undefined) {
      throw new Error("Expected to NOT be garbage collected but was.");
    }
  }
};

test("garbage collect teardown function when unsubscribed", async () => {
  const ref = new WeakRef(() => {});
  const promise = new LazyPromise<undefined>(() => ref.deref());
  const subscription = promise.subscribe();
  await expectNotCollected(ref);
  subscription.unsubscribe();
  await expectCollected(ref);
});

test("garbage collect teardown function when resolved", async () => {
  const ref = new WeakRef(() => {});
  let subscriber: InnerSubscriber<undefined>;
  const promise = new LazyPromise<undefined>((subscriberLocal) => {
    subscriber = subscriberLocal;
    return ref.deref();
  });
  // It's necessary to hold on to the subscription.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const subscription = promise.subscribe();
  await expectNotCollected(ref);
  subscriber!.resolve(undefined);
  await expectCollected(ref);
});

test("garbage collect teardown function when synchronously resolved with a promise", async () => {
  const ref = new WeakRef(() => {});
  const promise = new LazyPromise<undefined>((subscriber) => {
    subscriber.resolve(never);
    return ref.deref();
  });
  // It's necessary to hold on to the subscription.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const subscription = promise.subscribe();
  await expectCollected(ref);
});

test("garbage collect teardown function when asynchronously resolved with a promise", async () => {
  const ref = new WeakRef(() => {});
  let subscriber: InnerSubscriber<undefined>;
  const promise = new LazyPromise<undefined>((subscriberLocal) => {
    subscriber = subscriberLocal;
    return ref.deref();
  });
  // It's necessary to hold on to the subscription.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const subscription = promise.subscribe();
  await expectNotCollected(ref);
  subscriber!.resolve(never);
  await expectCollected(ref);
});

test("garbage collect teardown function when rejected", async () => {
  const ref = new WeakRef(() => {});
  let subscriber: InnerSubscriber<undefined>;
  const promise = new LazyPromise<undefined>((subscriberLocal) => {
    subscriber = subscriberLocal;
    return ref.deref();
  });
  // It's necessary to hold on to the subscription.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const subscription = promise.subscribe({ reject: () => {} });
  await expectNotCollected(ref);
  subscriber!.reject(undefined);
  await expectCollected(ref);
});

test("garbage collect subscriber when unsubscribed", async () => {
  const subscriber = new WeakRef({});
  const promise = new LazyPromise<never>(() => () => {});
  const subscription = promise.subscribe(subscriber.deref());
  await expectNotCollected(subscriber);
  subscription.unsubscribe();
  await expectCollected(subscriber);
});

test("garbage collect subscriber when unsubscribed (no teardown function)", async () => {
  const subscriber = new WeakRef({});
  const promise = new LazyPromise<never>(() => {});
  const subscription = promise.subscribe(subscriber.deref());
  await expectNotCollected(subscriber);
  subscription.unsubscribe();
  await expectCollected(subscriber);
});

test("garbage collect subscriber when resolved", async () => {
  const subscriber = new WeakRef({});
  let innerSubscriber: InnerSubscriber<undefined>;
  const promise = new LazyPromise<undefined>((subscriberLocal) => {
    innerSubscriber = subscriberLocal;
  });
  // It's necessary to hold on to the subscription.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const subscription = promise.subscribe(subscriber.deref());
  await expectNotCollected(subscriber);
  innerSubscriber!.resolve(undefined);
  await expectCollected(subscriber);
});

test("garbage collect subscriber when rejected", async () => {
  const subscriber = new WeakRef({
    reject: () => {},
  } satisfies Subscriber<undefined>);
  let innerSubscriber: InnerSubscriber<undefined>;
  const promise = new LazyPromise<undefined>((subscriberLocal) => {
    innerSubscriber = subscriberLocal;
  });
  // It's necessary to hold on to the subscription.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const subscription = promise.subscribe(subscriber.deref());
  await expectNotCollected(subscriber);
  innerSubscriber!.reject(undefined);
  await expectCollected(subscriber);
});

test("garbage collect subscriber when producer throws", async () => {
  const subscriber = new WeakRef({
    reject: () => {},
  } satisfies Subscriber<undefined>);
  const promise = new LazyPromise<undefined>(() => {
    throw "oops";
  });
  // It's necessary to hold on to the subscription.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const subscription = promise.subscribe(subscriber.deref());
  await expectCollected(subscriber);
});

test("garbage collect producer", async () => {
  const producer = new WeakRef(() => {});
  // It's necessary to hold on to the subscription.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const subscription = new LazyPromise<undefined>(
    producer.deref()!,
  ).subscribe();
  await expectCollected(producer);
});

test("garbage collect producer after it throws", async () => {
  const producer = new WeakRef(() => {
    throw "oops";
  });
  // It's necessary to hold on to the subscription.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const subscription = new LazyPromise<undefined>(producer.deref()!).subscribe({
    reject: () => {},
  });
  await expectCollected(producer);
});
