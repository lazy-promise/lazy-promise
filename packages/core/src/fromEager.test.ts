import type { LazyPromise } from "@lazy-promise/core";
import { fromEager, map } from "@lazy-promise/core";
import { afterEach, expect, expectTypeOf, test } from "vitest";

const logContents: unknown[] = [];

const mockMicrotaskQueue: (() => void)[] = [];
const originalQueueMicrotask = queueMicrotask;
const log = (...args: unknown[]) => {
  logContents.push(args);
};

const readLog = () => {
  try {
    return [...logContents];
  } finally {
    logContents.length = 0;
  }
};

const processMockMicrotaskQueue = () => {
  while (mockMicrotaskQueue.length) {
    mockMicrotaskQueue.shift()!();
  }
};

afterEach(() => {
  processMockMicrotaskQueue();
  global.queueMicrotask = originalQueueMicrotask;
  try {
    if (logContents.length) {
      throw new Error("Log expected to be empty at the end of each test.");
    }
  } finally {
    logContents.length = 0;
  }
  global.queueMicrotask = (task) => mockMicrotaskQueue.push(task);
});

const flushMicrotasks = async () => {
  await new Promise((resolve) => {
    setTimeout(resolve);
  });
};

const DOMException =
  (globalThis as any).DOMException ??
  (() => {
    try {
      atob("~");
    } catch (err) {
      return Object.getPrototypeOf(err).constructor;
    }
  })();

test("types", () => {
  /* eslint-disable require-await */

  expectTypeOf(fromEager(async () => "a" as const)).toEqualTypeOf<
    LazyPromise<"a">
  >();

  expectTypeOf(fromEager(() => Promise.reject(1))).toEqualTypeOf<
    LazyPromise<never>
  >();

  expectTypeOf(
    fromEager(() => {
      throw 1;
    }),
  ).toEqualTypeOf<LazyPromise<never>>();

  // Return generic type.
  const f = <T>(arg: T) => {
    const promise = fromEager(async () => arg);
    return promise.pipe(map((x) => x));
  };
  expectTypeOf(f("a" as const)).toEqualTypeOf<LazyPromise<"a">>();

  /* eslint-enable require-await */
});

test("source resolves", async () => {
  const promise = fromEager(() => Promise.resolve("value"));
  promise.subscribe(
    (value) => {
      log("handleValue", value);
    },
    () => {},
  );
  expect(readLog()).toMatchInlineSnapshot(`[]`);
  await flushMicrotasks();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleValue",
        "value",
      ],
    ]
  `);
});

test("source rejects", async () => {
  const promise = fromEager(() => Promise.reject("oops"));
  promise.subscribe(undefined, (error) => {
    log("handleError", error);
  });
  expect(readLog()).toMatchInlineSnapshot(`[]`);
  await flushMicrotasks();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleError",
        "oops",
      ],
    ]
  `);
});

test("source rejects with DOMException", async () => {
  const promise = fromEager(() => Promise.reject(new DOMException()));
  promise.subscribe(undefined, (error) => {
    log("handleError");
    expect(error).toBeInstanceOf(DOMException);
  });
  expect(readLog()).toMatchInlineSnapshot(`[]`);
  await flushMicrotasks();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleError",
      ],
    ]
  `);
});

test("callback throws synchronously", () => {
  const promise = fromEager(() => {
    throw "oops";
  });
  promise.subscribe(undefined, (error) => {
    log("handleError", error);
  });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleError",
        "oops",
      ],
    ]
  `);
});

test("callback throws asynchronously", async () => {
  // eslint-disable-next-line require-await
  const promise = fromEager(async () => {
    throw "oops";
  });
  promise.subscribe(undefined, (error) => {
    log("handleError", error);
  });
  expect(readLog()).toMatchInlineSnapshot(`[]`);
  await flushMicrotasks();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleError",
        "oops",
      ],
    ]
  `);
});

test("callback throws after unsubscribed", async () => {
  // eslint-disable-next-line require-await
  const promise = fromEager(async () => {
    throw "oops";
  });
  promise.subscribe(undefined, (error) => {
    log("handleError", error);
  })!();
  expect(readLog()).toMatchInlineSnapshot(`[]`);
  processMockMicrotaskQueue();
  await flushMicrotasks();
  expect(readLog()).toMatchInlineSnapshot(`[]`);
  expect(processMockMicrotaskQueue).toThrow("oops");
});

test("cancelation with abort signal", () => {
  const promise = fromEager(
    (options) =>
      new Promise((resolve, reject) => {
        log("produce");
        const { signal } = options;
        expect(signal).toBe(options.signal);
        expect(signal.aborted).toBe(false);
        signal.addEventListener("abort", () => {
          log("handleAbort", signal.reason.toString());
          expect(signal.aborted).toBe(true);
          expect(signal.reason instanceof DOMException).toBe(true);
          reject(signal.reason);
        });
      }),
  );
  const unsubscribe = promise.subscribe(undefined, () => {});
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "produce",
      ],
    ]
  `);
  unsubscribe!();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleAbort",
        "AbortError: The lazy promise no longer has any subscribers.",
      ],
    ]
  `);
});

test("un-aborted promise resolves", async () => {
  const promise = fromEager(() => Promise.resolve(1));
  promise.subscribe()!();
  await flushMicrotasks();
  expect(readLog()).toMatchInlineSnapshot(`[]`);
});
