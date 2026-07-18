import type { Consumer, LazyPromise } from "@lazy-promise/core";
import { box, ErrorBox, fromEager } from "@lazy-promise/core";
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

const logConsumer: Consumer<any> = {
  resolve: (value) => {
    log("handleValue", value);
  },
  reject: (error) => {
    log("handleError", error);
  },
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

  expectTypeOf(fromEager(() => "a" as const)).toEqualTypeOf<LazyPromise<"a">>();

  expectTypeOf(fromEager(() => box("a"))).toEqualTypeOf<LazyPromise<"a">>();

  expectTypeOf(fromEager(async () => "a" as const)).toEqualTypeOf<
    LazyPromise<"a">
  >();

  expectTypeOf(fromEager(async () => box("a"))).toEqualTypeOf<
    LazyPromise<"a">
  >();

  expectTypeOf(
    fromEager(async () => {
      if (true as boolean) {
        return box(new ErrorBox("error1"));
      }
      return "a";
    }),
  ).toEqualTypeOf<LazyPromise<"a" | ErrorBox<"error1">>>();

  expectTypeOf(
    fromEager(() => {
      if (true as boolean) {
        return "a";
      }
      if (true as boolean) {
        return box("b");
      }
      if (true as boolean) {
        return new Promise<"c">(() => {});
      }
      return new Promise<LazyPromise<"d">>(() => {});
    }),
  ).toEqualTypeOf<LazyPromise<"a" | "b" | "c" | "d">>();

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
    return promise.map((x) => x);
  };
  expectTypeOf(f("a" as const)).toEqualTypeOf<LazyPromise<"a">>();

  /* eslint-enable require-await */
});

test("value of this", () => {
  const promise = fromEager(function () {
    /** @ts-expect-error */
    log("in callback", this);
  });
  promise.subscribe();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "in callback",
        undefined,
      ],
    ]
  `);
});

test("source is a plain value", () => {
  const promise = fromEager(() => "value");
  promise.subscribe(logConsumer);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleValue",
        "value",
      ],
    ]
  `);
});

test("source is a lazy promise", () => {
  const promise = fromEager(() => box("value"));
  promise.subscribe(logConsumer);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleValue",
        "value",
      ],
    ]
  `);
});

test("source resolves with a plain value", async () => {
  const promise = fromEager(() => Promise.resolve("value"));
  promise.subscribe(logConsumer);
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

test("source resolves with a lazy promise", async () => {
  const promise = fromEager(() => Promise.resolve(box("value")));
  promise.subscribe(logConsumer);
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
  promise.subscribe(logConsumer);
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

test("callback throws synchronously", () => {
  const promise = fromEager(() => {
    throw "oops";
  });
  promise.subscribe(logConsumer);
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
  promise.subscribe(logConsumer);
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

test("callback throws after unsubscribed", () => {
  // eslint-disable-next-line require-await
  const promise = fromEager(async () => {
    throw "oops";
  });
  promise.subscribe(logConsumer).dispose();
  expect(readLog()).toMatchInlineSnapshot(`[]`);
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
  const subscription = promise.subscribe(logConsumer);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "produce",
      ],
    ]
  `);
  subscription.dispose();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleAbort",
        "AbortError: The lazy promise subscription was disposed.",
      ],
    ]
  `);
});

test("un-aborted promise resolves", async () => {
  const promise = fromEager(() => Promise.resolve(1));
  promise.subscribe().dispose();
  await flushMicrotasks();
  expect(readLog()).toMatchInlineSnapshot(`[]`);
});
