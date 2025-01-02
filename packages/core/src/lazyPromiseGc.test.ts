import { expect, test } from "@jest/globals";
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

test("garbage collect teardown function when unsubscribed", async () => {
  const ref = new WeakRef(() => {});
  const promise = createLazyPromise<undefined>(() => ref.deref());
  const dispose = promise.subscribe();
  await gc();
  expect(ref.deref()).toBeDefined();
  dispose();
  await gc();
  expect(ref.deref()).toBeUndefined();
});

test("garbage collect teardown function when resolved", async () => {
  const ref = new WeakRef(() => {});
  let resolve: (value: undefined) => void;
  const promise = createLazyPromise<undefined>((resolveLocal) => {
    resolve = resolveLocal;
    return ref.deref();
  });
  promise.subscribe();
  await gc();
  expect(ref.deref()).toBeDefined();
  resolve!(undefined);
  await gc();
  expect(ref.deref()).toBeUndefined();
});

test("garbage collect teardown function when rejected", async () => {
  const ref = new WeakRef(() => {});
  let reject: (error: undefined) => void;
  const promise = createLazyPromise<undefined, undefined>((_, rejectLocal) => {
    reject = rejectLocal;
    return ref.deref();
  });
  promise.subscribe(undefined, () => {});
  await gc();
  expect(ref.deref()).toBeDefined();
  reject!(undefined);
  await gc();
  expect(ref.deref()).toBeUndefined();
});

test("garbage collect produce function when resolved", async () => {
  let resolve: (value: undefined) => void;
  const ref = new WeakRef((resolveLocal: (value: undefined) => void) => {
    resolve = resolveLocal;
  });
  const promise = createLazyPromise<undefined>(ref.deref()!);
  promise.subscribe();
  await gc();
  expect(ref.deref()).toBeDefined();
  resolve!(undefined);
  await gc();
  expect(ref.deref()).toBeUndefined();
});

test("garbage collect produce function when rejected", async () => {
  let reject: (error: undefined) => void;
  const ref = new WeakRef(
    (_: unknown, rejectLocal: (error: undefined) => void) => {
      reject = rejectLocal;
    },
  );
  const promise = createLazyPromise<undefined, undefined>(ref.deref()!);
  promise.subscribe(undefined, () => {});
  await gc();
  expect(ref.deref()).toBeDefined();
  reject!(undefined);
  await gc();
  expect(ref.deref()).toBeUndefined();
});

test("garbage collect subscriber callbacks when unsubscribed", async () => {
  const resolve1 = new WeakRef(() => {});
  const reject1 = new WeakRef(() => {});
  const resolve2 = new WeakRef(() => {});
  const reject2 = new WeakRef(() => {});
  const promise = createLazyPromise(() => {});
  const dispose1 = promise.subscribe(resolve1.deref(), reject1.deref());
  const dispose2 = promise.subscribe(resolve2.deref(), reject2.deref());
  await gc();
  expect(resolve1.deref()).toBeDefined();
  expect(reject1.deref()).toBeDefined();
  expect(resolve2.deref()).toBeDefined();
  expect(reject2.deref()).toBeDefined();
  dispose1();
  await gc();
  expect(resolve1.deref()).toBeUndefined();
  expect(reject1.deref()).toBeUndefined();
  expect(resolve2.deref()).toBeDefined();
  expect(reject2.deref()).toBeDefined();
  dispose2();
  await gc();
  expect(resolve1.deref()).toBeUndefined();
  expect(reject1.deref()).toBeUndefined();
  expect(resolve2.deref()).toBeUndefined();
  expect(reject2.deref()).toBeUndefined();
});

test("garbage collect subscriber callbacks when resolved", async () => {
  const resolve = new WeakRef(() => {});
  const reject = new WeakRef(() => {});
  let resolvePromise: (value: undefined) => void;
  const promise = createLazyPromise((resolve) => {
    resolvePromise = resolve;
  });
  // It's necessary to hold on to the teardown function.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const dispose = promise.subscribe(resolve.deref(), reject.deref());
  await gc();
  expect(resolve.deref()).toBeDefined();
  expect(reject.deref()).toBeDefined();
  resolvePromise!(undefined);
  await gc();
  expect(resolve.deref()).toBeUndefined();
  expect(reject.deref()).toBeUndefined();
});

test("garbage collect subscriber callbacks when rejected", async () => {
  const resolve = new WeakRef(() => {});
  const reject = new WeakRef(() => {});
  let rejectPromise: (error: undefined) => void;
  const promise = createLazyPromise<undefined, undefined>((_, reject) => {
    rejectPromise = reject;
  });
  // It's necessary to hold on to the teardown function.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const dispose = promise.subscribe(resolve.deref(), reject.deref()!);
  await gc();
  expect(resolve.deref()).toBeDefined();
  expect(reject.deref()).toBeDefined();
  rejectPromise!(undefined);
  await gc();
  expect(resolve.deref()).toBeUndefined();
  expect(reject.deref()).toBeUndefined();
});
