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
  const promise = new LazyPromise<undefined, undefined>(
    (resolve, rejectLocal) => {
      reject = rejectLocal;
      return ref.deref();
    },
  );
  promise.subscribe(undefined, () => {});
  await expectNotCollected(ref);
  reject!(undefined);
  await expectCollected(ref);
});

test("garbage collect teardown function when failed", async () => {
  const ref = new WeakRef(() => {});
  let fail: (error: unknown) => void;
  const promise = new LazyPromise<undefined, never>(
    (resolve, reject, failLocal) => {
      fail = failLocal;
      return ref.deref();
    },
  );
  promise.subscribe(undefined, undefined, () => {});
  await expectNotCollected(ref);
  fail!(undefined);
  await expectCollected(ref);
});

test("garbage collect produce function when resolved", async () => {
  let resolve: (value: undefined) => void;
  const ref = new WeakRef((resolveLocal: (value: undefined) => void) => {
    resolve = resolveLocal;
    return () => {};
  });
  const promise = new LazyPromise<undefined>(ref.deref()!);
  promise.subscribe();
  await expectNotCollected(ref);
  resolve!(undefined);
  await expectCollected(ref);
});

test("garbage collect produce function when rejected", async () => {
  let reject: (error: undefined) => void;
  const ref = new WeakRef(
    (resolve: unknown, rejectLocal: (error: undefined) => void) => {
      reject = rejectLocal;
      return () => {};
    },
  );
  const promise = new LazyPromise<undefined, undefined>(ref.deref()!);
  promise.subscribe(undefined, () => {});
  await expectNotCollected(ref);
  reject!(undefined);
  await expectCollected(ref);
});

test("garbage collect produce function when failed", async () => {
  let fail: (error: unknown) => void;
  const ref = new WeakRef(
    (
      resolve: unknown,
      reject: unknown,
      failLocal: (error: unknown) => void,
    ) => {
      fail = failLocal;
      return () => {};
    },
  );
  const promise = new LazyPromise<undefined, never>(ref.deref()!);
  promise.subscribe(undefined, undefined, () => {});
  await expectNotCollected(ref);
  fail!(undefined);
  await expectCollected(ref);
});

test("garbage collect subscriber callbacks when unsubscribed", async () => {
  const handleValue1 = new WeakRef(() => {});
  const handleRejection1 = new WeakRef(() => {});
  const handleFailure1 = new WeakRef(() => {});
  const handleValue2 = new WeakRef(() => {});
  const handleRejection2 = new WeakRef(() => {});
  const handleFailure2 = new WeakRef(() => {});
  const promise = new LazyPromise(() => () => {});
  const unsubscribe1 = promise.subscribe(
    handleValue1.deref(),
    handleRejection1.deref(),
    handleFailure1.deref(),
  );
  const unsubscribe2 = promise.subscribe(
    handleValue2.deref(),
    handleRejection2.deref(),
    handleFailure2.deref(),
  );
  await expectNotCollected(handleValue1);
  await expectNotCollected(handleRejection1);
  await expectNotCollected(handleFailure1);
  await expectNotCollected(handleValue2);
  await expectNotCollected(handleRejection2);
  await expectNotCollected(handleFailure2);
  unsubscribe1!();
  await expectCollected(handleValue1);
  await expectCollected(handleRejection1);
  await expectCollected(handleFailure1);
  await expectNotCollected(handleValue2);
  await expectNotCollected(handleRejection2);
  await expectNotCollected(handleFailure2);
  unsubscribe2!();
  await expectCollected(handleValue2);
  await expectCollected(handleRejection2);
  await expectCollected(handleFailure2);
});

test("garbage collect subscriber callbacks when unsubscribed (no teardown function)", async () => {
  const handleValue1 = new WeakRef(() => {});
  const handleRejection1 = new WeakRef(() => {});
  const handleFailure1 = new WeakRef(() => {});
  const handleValue2 = new WeakRef(() => {});
  const handleRejection2 = new WeakRef(() => {});
  const handleFailure2 = new WeakRef(() => {});
  const promise = new LazyPromise(() => {});
  promise.subscribe(
    handleValue1.deref(),
    handleRejection1.deref(),
    handleFailure1.deref(),
  );
  promise.subscribe(
    handleValue2.deref(),
    handleRejection2.deref(),
    handleFailure2.deref(),
  );
  await expectCollected(handleValue1);
  await expectCollected(handleRejection1);
  await expectCollected(handleFailure1);
  await expectCollected(handleValue2);
  await expectCollected(handleRejection2);
  await expectCollected(handleFailure2);
});

test("garbage collect subscriber callbacks when resolved", async () => {
  const handleValue = new WeakRef(() => {});
  const handleRejection = new WeakRef(() => {});
  const handleFailure = new WeakRef(() => {});
  let resolve: (value: undefined) => void;
  const promise = new LazyPromise((resolveLocal) => {
    resolve = resolveLocal;
    return () => {};
  });
  // It's necessary to hold on to the teardown function.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const unsubscribe = promise.subscribe(
    handleValue.deref(),
    handleRejection.deref(),
    handleFailure.deref(),
  );
  await expectNotCollected(handleValue);
  await expectNotCollected(handleRejection);
  await expectNotCollected(handleFailure);
  resolve!(undefined);
  await expectCollected(handleValue);
  await expectCollected(handleRejection);
  await expectCollected(handleFailure);
});

test("garbage collect subscriber callbacks when rejected", async () => {
  const handleValue = new WeakRef(() => {});
  const handleRejection = new WeakRef(() => {});
  const handleFailure = new WeakRef(() => {});
  let reject: (error: undefined) => void;
  const promise = new LazyPromise<undefined, undefined>(
    (resolve, rejectLocal) => {
      reject = rejectLocal;
      return () => {};
    },
  );
  // It's necessary to hold on to the teardown function.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const unsubscribe = promise.subscribe(
    handleValue.deref(),
    handleRejection.deref()!,
    handleFailure.deref(),
  );
  await expectNotCollected(handleValue);
  await expectNotCollected(handleRejection);
  await expectNotCollected(handleFailure);
  reject!(undefined);
  await expectCollected(handleValue);
  await expectCollected(handleRejection);
  await expectCollected(handleFailure);
});

test("garbage collect subscriber callbacks when failed", async () => {
  const handleValue = new WeakRef(() => {});
  const handleRejection = new WeakRef(() => {});
  const handleFailure = new WeakRef(() => {});
  let fail: (error: unknown) => void;
  const promise = new LazyPromise<undefined, never>(
    (resolve, reject, failLocal) => {
      fail = failLocal;
      return () => {};
    },
  );
  // It's necessary to hold on to the teardown function.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const unsubscribe = promise.subscribe(
    handleValue.deref(),
    handleRejection.deref(),
    handleFailure.deref(),
  );
  await expectNotCollected(handleValue);
  await expectNotCollected(handleRejection);
  await expectNotCollected(handleFailure);
  fail!(undefined);
  await expectCollected(handleValue);
  await expectCollected(handleRejection);
  await expectCollected(handleFailure);
});
