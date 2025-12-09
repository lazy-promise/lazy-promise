import { test } from "@jest/globals";
import { createLazyPromise } from "./lazyPromise";

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
  const promise = createLazyPromise<undefined>(() => ref.deref());
  const dispose = promise.subscribe();
  await expectNotCollected(ref);
  dispose();
  await expectCollected(ref);
});

test("garbage collect teardown function when resolved", async () => {
  const ref = new WeakRef(() => {});
  let resolve: (value: undefined) => void;
  const promise = createLazyPromise<undefined>((resolveLocal) => {
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
  const promise = createLazyPromise<undefined, undefined>(
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
  const promise = createLazyPromise<undefined, never>(
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
  });
  const promise = createLazyPromise<undefined>(ref.deref()!);
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
    },
  );
  const promise = createLazyPromise<undefined, undefined>(ref.deref()!);
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
    },
  );
  const promise = createLazyPromise<undefined, never>(ref.deref()!);
  promise.subscribe(undefined, undefined, () => {});
  await expectNotCollected(ref);
  fail!(undefined);
  await expectCollected(ref);
});

test("garbage collect subscriber callbacks when unsubscribed", async () => {
  const handleValue1 = new WeakRef(() => {});
  const handleError1 = new WeakRef(() => {});
  const handleFailure1 = new WeakRef(() => {});
  const handleValue2 = new WeakRef(() => {});
  const handleError2 = new WeakRef(() => {});
  const handleFailure2 = new WeakRef(() => {});
  const promise = createLazyPromise(() => {});
  const dispose1 = promise.subscribe(
    handleValue1.deref(),
    handleError1.deref(),
    handleFailure1.deref(),
  );
  const dispose2 = promise.subscribe(
    handleValue2.deref(),
    handleError2.deref(),
    handleFailure2.deref(),
  );
  await expectNotCollected(handleValue1);
  await expectNotCollected(handleError1);
  await expectNotCollected(handleFailure1);
  await expectNotCollected(handleValue2);
  await expectNotCollected(handleError2);
  await expectNotCollected(handleFailure2);
  dispose1();
  await expectCollected(handleValue1);
  await expectCollected(handleError1);
  await expectCollected(handleFailure1);
  await expectNotCollected(handleValue2);
  await expectNotCollected(handleError2);
  await expectNotCollected(handleFailure2);
  dispose2();
  await expectCollected(handleValue2);
  await expectCollected(handleError2);
  await expectCollected(handleFailure2);
});

test("garbage collect subscriber callbacks when resolved", async () => {
  const handleValue = new WeakRef(() => {});
  const handleError = new WeakRef(() => {});
  const handleFailure = new WeakRef(() => {});
  let resolve: (value: undefined) => void;
  const promise = createLazyPromise((resolveLocal) => {
    resolve = resolveLocal;
  });
  // It's necessary to hold on to the teardown function.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const dispose = promise.subscribe(
    handleValue.deref(),
    handleError.deref(),
    handleFailure.deref(),
  );
  await expectNotCollected(handleValue);
  await expectNotCollected(handleError);
  await expectNotCollected(handleFailure);
  resolve!(undefined);
  await expectCollected(handleValue);
  await expectCollected(handleError);
  await expectCollected(handleFailure);
});

test("garbage collect subscriber callbacks when rejected", async () => {
  const handleValue = new WeakRef(() => {});
  const handleError = new WeakRef(() => {});
  const handleFailure = new WeakRef(() => {});
  let reject: (error: undefined) => void;
  const promise = createLazyPromise<undefined, undefined>(
    (resolve, rejectLocal) => {
      reject = rejectLocal;
    },
  );
  // It's necessary to hold on to the teardown function.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const dispose = promise.subscribe(
    handleValue.deref(),
    handleError.deref()!,
    handleFailure.deref(),
  );
  await expectNotCollected(handleValue);
  await expectNotCollected(handleError);
  await expectNotCollected(handleFailure);
  reject!(undefined);
  await expectCollected(handleValue);
  await expectCollected(handleError);
  await expectCollected(handleFailure);
});

test("garbage collect subscriber callbacks when failed", async () => {
  const handleValue = new WeakRef(() => {});
  const handleError = new WeakRef(() => {});
  const handleFailure = new WeakRef(() => {});
  let fail: (error: unknown) => void;
  const promise = createLazyPromise<undefined, never>(
    (resolve, reject, failLocal) => {
      fail = failLocal;
    },
  );
  // It's necessary to hold on to the teardown function.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const dispose = promise.subscribe(
    handleValue.deref(),
    handleError.deref(),
    handleFailure.deref(),
  );
  await expectNotCollected(handleValue);
  await expectNotCollected(handleError);
  await expectNotCollected(handleFailure);
  fail!(undefined);
  await expectCollected(handleValue);
  await expectCollected(handleError);
  await expectCollected(handleFailure);
});
