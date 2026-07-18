import type { Consumer, Sink } from "@lazy-promise/core";
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
  subscription.dispose();
  await expectCollected(ref);
});

test("garbage collect teardown function when resolved", async () => {
  const ref = new WeakRef(() => {});
  let sink: Sink<undefined>;
  const promise = new LazyPromise<undefined>((sinkLocal) => {
    sink = sinkLocal;
    return ref.deref();
  });
  // It's necessary to hold on to the subscription.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const subscription = promise.subscribe();
  await expectNotCollected(ref);
  sink!.resolve(undefined);
  await expectCollected(ref);
});

test("garbage collect teardown function when synchronously resolved with a promise", async () => {
  const ref = new WeakRef(() => {});
  const promise = new LazyPromise<undefined>((sink) => {
    sink.resolve(never);
    return ref.deref();
  });
  // It's necessary to hold on to the subscription.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const subscription = promise.subscribe();
  await expectCollected(ref);
});

test("garbage collect teardown function when asynchronously resolved with a promise", async () => {
  const ref = new WeakRef(() => {});
  let sink: Sink<undefined>;
  const promise = new LazyPromise<undefined>((sinkLocal) => {
    sink = sinkLocal;
    return ref.deref();
  });
  // It's necessary to hold on to the subscription.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const subscription = promise.subscribe();
  await expectNotCollected(ref);
  sink!.resolve(never);
  await expectCollected(ref);
});

test("garbage collect teardown function when rejected", async () => {
  const ref = new WeakRef(() => {});
  let sink: Sink<undefined>;
  const promise = new LazyPromise<undefined>((sinkLocal) => {
    sink = sinkLocal;
    return ref.deref();
  });
  // It's necessary to hold on to the subscription.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const subscription = promise.subscribe({ reject: () => {} });
  await expectNotCollected(ref);
  sink!.reject(undefined);
  await expectCollected(ref);
});

test("garbage collect consumer when unsubscribed", async () => {
  const consumer = new WeakRef({});
  const promise = new LazyPromise<never>(() => () => {});
  const subscription = promise.subscribe(consumer.deref());
  await expectNotCollected(consumer);
  subscription.dispose();
  await expectCollected(consumer);
});

test("garbage collect consumer when unsubscribed (no teardown function)", async () => {
  const consumer = new WeakRef({});
  const promise = new LazyPromise<never>(() => {});
  const subscription = promise.subscribe(consumer.deref());
  await expectNotCollected(consumer);
  subscription.dispose();
  await expectCollected(consumer);
});

test("garbage collect consumer when resolved", async () => {
  const consumer = new WeakRef({});
  let sink: Sink<undefined>;
  const promise = new LazyPromise<undefined>((sinkLocal) => {
    sink = sinkLocal;
  });
  // It's necessary to hold on to the subscription.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const subscription = promise.subscribe(consumer.deref());
  await expectNotCollected(consumer);
  sink!.resolve(undefined);
  await expectCollected(consumer);
});

test("garbage collect consumer when rejected", async () => {
  const consumer = new WeakRef({
    reject: () => {},
  } satisfies Consumer<undefined>);
  let sink: Sink<undefined>;
  const promise = new LazyPromise<undefined>((sinkLocal) => {
    sink = sinkLocal;
  });
  // It's necessary to hold on to the subscription.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const subscription = promise.subscribe(consumer.deref());
  await expectNotCollected(consumer);
  sink!.reject(undefined);
  await expectCollected(consumer);
});

test("garbage collect consumer when producer throws", async () => {
  const consumer = new WeakRef({
    reject: () => {},
  } satisfies Consumer<undefined>);
  const promise = new LazyPromise<undefined>(() => {
    throw "oops";
  });
  // It's necessary to hold on to the subscription.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const subscription = promise.subscribe(consumer.deref());
  await expectCollected(consumer);
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
