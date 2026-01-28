import {
  box,
  failed,
  fromEager,
  LazyPromise,
  map,
  rejected,
} from "@lazy-promise/core";
import { afterEach, expect, test } from "vitest";

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
  /* eslint-disable @typescript-eslint/no-unused-vars */
  /* eslint-disable require-await */

  // $ExpectType LazyPromise<"a", never>
  const promise1 = fromEager(async () => "a" as const);

  // $ExpectType LazyPromise<"a", "error1">
  const promise2 = fromEager(async () => {
    if (true as boolean) {
      return rejected("error1");
    }
    return "a";
  });

  // $ExpectType LazyPromise<never, never>
  const promise3 = fromEager(() => Promise.reject(1));

  // $ExpectType LazyPromise<never, 1>
  const promise4 = fromEager(async () => rejected(1));

  // $ExpectType LazyPromise<never, never>
  const promise5 = fromEager(() => {
    throw 1;
  });

  // Return generic type.
  const f = <T>(arg: T) => {
    const promise = fromEager(async () => arg);
    return promise.pipe(map((x) => x));
  };
  // $ExpectType LazyPromise<"a", never>
  const x = f("a" as const);

  /* eslint-enable require-await */
  /* eslint-enable @typescript-eslint/no-unused-vars */
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
  promise.subscribe(undefined, undefined, (error) => {
    log("handleFailure", error);
  });
  expect(readLog()).toMatchInlineSnapshot(`[]`);
  await flushMicrotasks();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleFailure",
        "oops",
      ],
    ]
  `);
});

test("source rejects with DOMException", async () => {
  const promise = fromEager(() => Promise.reject(new DOMException()));
  promise.subscribe(undefined, undefined, (error) => {
    log("handleFailure");
    expect(error).toBeInstanceOf(DOMException);
  });
  expect(readLog()).toMatchInlineSnapshot(`[]`);
  await flushMicrotasks();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleFailure",
      ],
    ]
  `);
});

test("callback throws synchronously", () => {
  const promise = fromEager(() => {
    throw "oops";
  });
  promise.subscribe(undefined, undefined, (error) => {
    log("handleFailure", error);
  });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleFailure",
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
  promise.subscribe(undefined, undefined, (error) => {
    log("handleFailure", error);
  });
  expect(readLog()).toMatchInlineSnapshot(`[]`);
  await flushMicrotasks();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleFailure",
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
  promise.subscribe(undefined, undefined, (error) => {
    log("handleFailure", error);
  })();
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
  const dispose = promise.subscribe(undefined, () => {});
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "produce",
      ],
    ]
  `);
  dispose();
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
  promise.subscribe()();
  await flushMicrotasks();
  expect(readLog()).toMatchInlineSnapshot(`[]`);
});

test("flattened promise resolves", async () => {
  // eslint-disable-next-line require-await
  const promise = fromEager(async () => box("a"));
  promise.subscribe((value) => {
    log("handleValue", value);
  });
  expect(readLog()).toMatchInlineSnapshot(`[]`);
  await flushMicrotasks();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleValue",
        "a",
      ],
    ]
  `);
});

test("flattened promise rejects", async () => {
  // eslint-disable-next-line require-await
  const promise = fromEager(async () => rejected("a"));
  promise.subscribe(undefined, (error) => {
    log("handleRejection", error);
  });
  expect(readLog()).toMatchInlineSnapshot(`[]`);
  await flushMicrotasks();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleRejection",
        "a",
      ],
    ]
  `);
});

test("flattened promise fails", async () => {
  // eslint-disable-next-line require-await
  const promise = fromEager(async () => failed("a"));
  promise.subscribe(undefined, undefined, (error) => {
    log("handleFailure", error);
  });
  expect(readLog()).toMatchInlineSnapshot(`[]`);
  await flushMicrotasks();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleFailure",
        "a",
      ],
    ]
  `);
});

test("unsubscribe flattened promise", async () => {
  const promise = fromEager(
    // eslint-disable-next-line require-await
    async () =>
      new LazyPromise<never>(() => {
        log("subscribe");
        return () => {
          log("unsubscribe");
        };
      }),
  );
  const unsubscribe = promise.subscribe();
  expect(readLog()).toMatchInlineSnapshot(`[]`);
  await flushMicrotasks();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "subscribe",
      ],
    ]
  `);
  unsubscribe();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "unsubscribe",
      ],
    ]
  `);
});
