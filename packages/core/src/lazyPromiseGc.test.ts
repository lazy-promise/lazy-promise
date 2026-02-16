import { LazyPromise } from "@lazy-promise/core";
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
  const unsubscribe = promise.subscribe();
  await expectNotCollected(ref);
  unsubscribe!();
  await expectCollected(ref);
});

test("garbage collect teardown function when resolved", async () => {
  const ref = new WeakRef(() => {});
  let resolve: (value: undefined) => void;
  const promise = new LazyPromise<undefined>((resolveLocal) => {
    resolve = resolveLocal;
    return ref.deref();
  });
  promise.subscribe();
  await expectNotCollected(ref);
  resolve!(undefined);
  await expectCollected(ref);
});

test("garbage collect teardown function when rejected", async () => {
  const ref = new WeakRef(() => {});
  let reject: (error: undefined) => void;
  const promise = new LazyPromise<undefined>((resolve, rejectLocal) => {
    reject = rejectLocal;
    return ref.deref();
  });
  promise.subscribe(undefined, () => {});
  await expectNotCollected(ref);
  reject!(undefined);
  await expectCollected(ref);
});

test("garbage collect subscriber callbacks when unsubscribed", async () => {
  const handleValue1 = new WeakRef(() => {});
  const handleError1 = new WeakRef(() => {});
  const handleValue2 = new WeakRef(() => {});
  const handleError2 = new WeakRef(() => {});
  const promise = new LazyPromise(() => () => {});
  const unsubscribe1 = promise.subscribe(
    handleValue1.deref(),
    handleError1.deref(),
  );
  const unsubscribe2 = promise.subscribe(
    handleValue2.deref(),
    handleError2.deref(),
  );
  await expectNotCollected(handleValue1);
  await expectNotCollected(handleError1);
  await expectNotCollected(handleValue2);
  await expectNotCollected(handleError2);
  unsubscribe1!();
  await expectCollected(handleValue1);
  await expectCollected(handleError1);
  await expectNotCollected(handleValue2);
  await expectNotCollected(handleError2);
  unsubscribe2!();
  await expectCollected(handleValue2);
  await expectCollected(handleError2);
});

test("garbage collect subscriber callbacks when unsubscribed (no teardown function)", async () => {
  const handleValue1 = new WeakRef(() => {});
  const handleError1 = new WeakRef(() => {});
  const handleValue2 = new WeakRef(() => {});
  const handleError2 = new WeakRef(() => {});
  const promise = new LazyPromise(() => {});
  promise.subscribe(handleValue1.deref(), handleError1.deref());
  promise.subscribe(handleValue2.deref(), handleError2.deref());
  await expectCollected(handleValue1);
  await expectCollected(handleError1);
  await expectCollected(handleValue2);
  await expectCollected(handleError2);
});

test("garbage collect subscriber callbacks when resolved", async () => {
  const handleValue = new WeakRef(() => {});
  const handleError = new WeakRef(() => {});
  let resolve: (value: undefined) => void;
  const promise = new LazyPromise((resolveLocal) => {
    resolve = resolveLocal;
    return () => {};
  });
  // It's necessary to hold on to the teardown function.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const unsubscribe = promise.subscribe(
    handleValue.deref(),
    handleError.deref(),
  );
  await expectNotCollected(handleValue);
  await expectNotCollected(handleError);
  resolve!(undefined);
  await expectCollected(handleValue);
  await expectCollected(handleError);
});

test("garbage collect subscriber callbacks when rejected", async () => {
  const handleValue = new WeakRef(() => {});
  const handleError = new WeakRef(() => {});
  let reject: (error: undefined) => void;
  const promise = new LazyPromise<undefined>((resolve, rejectLocal) => {
    reject = rejectLocal;
    return () => {};
  });
  // It's necessary to hold on to the teardown function.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const unsubscribe = promise.subscribe(
    handleValue.deref(),
    handleError.deref()!,
  );
  await expectNotCollected(handleValue);
  await expectNotCollected(handleError);
  reject!(undefined);
  await expectCollected(handleValue);
  await expectCollected(handleError);
});
