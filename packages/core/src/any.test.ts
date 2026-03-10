import type { InnerSubscriber, Subscriber } from "@lazy-promise/core";
import { any, box, LazyPromise, TypedError } from "@lazy-promise/core";
import { afterEach, beforeEach, expect, expectTypeOf, test, vi } from "vitest";

const mockMicrotaskQueue: (() => void)[] = [];
const originalQueueMicrotask = queueMicrotask;
const logContents: unknown[] = [];
let logTime: number;

const log = (...args: unknown[]) => {
  const currentTime = Date.now();
  if (currentTime !== logTime) {
    logContents.push(`${currentTime - logTime} ms passed`);
    logTime = currentTime;
  }
  logContents.push(args);
};

const readLog = () => {
  try {
    return [...logContents];
  } finally {
    logContents.length = 0;
  }
};

const logSubscriber: Subscriber<any> = {
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

beforeEach(() => {
  vi.useFakeTimers();
  logTime = Date.now();
  global.queueMicrotask = (task) => mockMicrotaskQueue.push(task);
});

afterEach(() => {
  processMockMicrotaskQueue();
  global.queueMicrotask = originalQueueMicrotask;
  vi.useRealTimers();
  try {
    if (logContents.length) {
      throw new Error("Log expected to be empty at the end of each test.");
    }
  } finally {
    logContents.length = 0;
  }
});

test("types", () => {
  expectTypeOf(any([])).toEqualTypeOf<LazyPromise<TypedError<[]>>>();

  expectTypeOf(
    any([
      new LazyPromise<"value a" | TypedError<"error a">>(() => {}),
      (true as boolean) ? "value b" : new TypedError("error b"),
    ]),
  ).toEqualTypeOf<
    LazyPromise<"value a" | "value b" | TypedError<["error a", "error b"]>>
  >();

  expectTypeOf(
    any([
      new LazyPromise<"value a" | TypedError<"error a">>(() => {}),
      new LazyPromise<never>(() => {}),
    ]),
  ).toEqualTypeOf<LazyPromise<"value a">>();

  expectTypeOf(any({})).toEqualTypeOf<LazyPromise<TypedError<{}>>>();

  expectTypeOf(
    any({
      a: new LazyPromise<"value a" | TypedError<"error a">>(() => {}),
      b: (true as boolean) ? "value b" : new TypedError("error b"),
    }),
  ).toEqualTypeOf<
    LazyPromise<
      | "value a"
      | "value b"
      | TypedError<{
          readonly a: "error a";
          readonly b: "error b";
        }>
    >
  >();

  expectTypeOf(
    any({
      a: new LazyPromise<"value a" | TypedError<"error a">>(() => {}),
      b: new LazyPromise<never>(() => {}),
    }),
  ).toEqualTypeOf<LazyPromise<"value a">>();

  expectTypeOf(any(new Set([]))).toEqualTypeOf<
    LazyPromise<TypedError<never[]>>
  >();

  expectTypeOf(
    any(
      new Set([
        new LazyPromise<"value a" | TypedError<"error a">>(() => {}),
        "value b" as const,
        new TypedError("error b"),
      ]),
    ),
  ).toEqualTypeOf<
    LazyPromise<"value a" | "value b" | TypedError<("error a" | "error b")[]>>
  >();
});

test("empty iterable", () => {
  const promise = any([]);
  promise.subscribe(logSubscriber);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleValue",
        TypedError {
          "error": [],
        },
      ],
    ]
  `);
});

test("empty object", () => {
  const promise = any({});
  promise.subscribe(logSubscriber);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleValue",
        TypedError {
          "error": {},
        },
      ],
    ]
  `);
});

test("sync resolve (iterable)", () => {
  const promise = any([
    box(new TypedError("a" as const)),
    new TypedError("b" as const),
  ]);
  promise.subscribe(logSubscriber);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleValue",
        TypedError {
          "error": [
            "a",
            "b",
          ],
        },
      ],
    ]
  `);
});

test("sync resolve (object)", () => {
  const promise = any({
    a: box(new TypedError("a" as const)),
    b: new TypedError("b" as const),
  });
  promise.subscribe(logSubscriber);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleValue",
        TypedError {
          "error": {
            "a": "a",
            "b": "b",
          },
        },
      ],
    ]
  `);
});

test("non-array iterable", () => {
  const promise = any(new Set([box(new TypedError("a"))]));
  promise.subscribe(logSubscriber);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleValue",
        TypedError {
          "error": [
            "a",
          ],
        },
      ],
    ]
  `);
});

test("async resolve with typed errors", () => {
  const promise = any([
    new LazyPromise<TypedError<"a">>((subscriber) => {
      setTimeout(() => {
        subscriber.resolve(new TypedError("a"));
      }, 2000);
    }),
    new LazyPromise<TypedError<"b">>((subscriber) => {
      setTimeout(() => {
        subscriber.resolve(new TypedError("b"));
      }, 1000);
    }),
    box(new TypedError("c")),
  ]);
  promise.subscribe(logSubscriber);
  vi.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "2000 ms passed",
      [
        "handleValue",
        TypedError {
          "error": [
            "a",
            "b",
            "c",
          ],
        },
      ],
    ]
  `);
});

test("non-error value passed as one of the sources should resolve result", () => {
  const promise = any([new TypedError("oops"), "a"]);
  promise.subscribe(logSubscriber);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleValue",
        "a",
      ],
    ]
  `);
});

test("resolving of one of the sources should resolve result", () => {
  const promise = any([
    new LazyPromise<"a">(() => () => {
      log("dispose a");
    }),
    new LazyPromise<"b">((subscriber) => {
      setTimeout(() => {
        subscriber.resolve("b");
      }, 1000);
    }),
  ]);
  promise.subscribe(logSubscriber);
  vi.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "1000 ms passed",
      [
        "handleValue",
        "b",
      ],
      [
        "dispose a",
      ],
    ]
  `);
});

test("rejection of one of the sources should reject result", () => {
  const promise = any([
    new LazyPromise<"a">(() => () => {
      log("dispose a");
    }),
    new LazyPromise((subscriber) => {
      setTimeout(() => {
        subscriber.reject("oops");
      }, 1000);
    }),
  ]);
  promise.subscribe(logSubscriber);
  vi.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "1000 ms passed",
      [
        "handleError",
        "oops",
      ],
      [
        "dispose a",
      ],
    ]
    `);
});

test("internally disposed when a source in an iterable resolves, internal disposal should prevent further subscriptions to sources", () => {
  const promise = any([
    new LazyPromise<TypedError<string>>(() => {
      log("produce a");
      return () => {
        log("dispose a");
      };
    }),
    box("b"),
    new LazyPromise<TypedError<string>>(() => {
      log("produce c");
    }),
  ]);
  promise.subscribe(logSubscriber);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "produce a",
      ],
      [
        "handleValue",
        "b",
      ],
      [
        "dispose a",
      ],
    ]
  `);
});

test("internally disposed when a source in an object resolves, internal disposal should prevent further subscriptions to sources", () => {
  const promise = any({
    a: new LazyPromise<TypedError<string>>(() => {
      log("produce a");
      return () => {
        log("dispose a");
      };
    }),
    b: box("b"),
    c: new LazyPromise<TypedError<string>>(() => {
      log("produce c");
    }),
  });
  promise.subscribe(logSubscriber);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "produce a",
      ],
      [
        "handleValue",
        "b",
      ],
      [
        "dispose a",
      ],
    ]
  `);
});

test("unsubscribe", () => {
  const promise = any([
    new LazyPromise<"a">(() => {
      log("produce a");
      return () => {
        log("dispose a");
      };
    }),
    box(new TypedError("b")),
  ]);
  const subscription = promise.subscribe();
  vi.advanceTimersByTime(1000);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "produce a",
      ],
    ]
  `);
  subscription.unsubscribe();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "1000 ms passed",
      [
        "dispose a",
      ],
    ]
  `);
});

test("internally disposed when a source resolves, a source resolve is ignored when internally disposed", () => {
  let subscriberA: InnerSubscriber<"a">;
  const promise = any([
    new LazyPromise<"a">((subscriber) => {
      log("produce a");
      subscriberA = subscriber;
    }),
    new LazyPromise<"b">((subscriber) => {
      setTimeout(() => {
        log("call resolve b");
        subscriber.resolve("b");
      }, 1000);
    }),
  ]);
  promise.subscribe({
    resolve: () => {
      log("call resolve a");
      subscriberA.resolve("a");
    },
  });
  vi.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "produce a",
      ],
      "1000 ms passed",
      [
        "call resolve b",
      ],
      [
        "call resolve a",
      ],
    ]
  `);
});

test("internally disposed when a source resolves, a source reject is ignored when internally disposed", () => {
  let subscriberA: InnerSubscriber<"a">;
  const promise = any([
    new LazyPromise<"a">((subscriber) => {
      log("produce a");
      subscriberA = subscriber;
    }),
    new LazyPromise<"b">((subscriber) => {
      setTimeout(() => {
        log("call resolve b");
        subscriber.resolve("b");
      }, 1000);
    }),
  ]);
  promise.subscribe({
    resolve: () => {
      log("call reject a");
      subscriberA.reject("oops");
    },
  });
  vi.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "produce a",
      ],
      "1000 ms passed",
      [
        "call resolve b",
      ],
      [
        "call reject a",
      ],
    ]
  `);
});

test("internally disposed when a source rejects, a source resolve is ignored when internally disposed", () => {
  let subscriberA: InnerSubscriber<"a">;
  const promise = any([
    new LazyPromise<"a">((subscriber) => {
      subscriberA = subscriber;
    }),
    new LazyPromise<never>((subscriber) => {
      setTimeout(() => {
        log("call reject b");
        subscriber.reject("oops");
      }, 1000);
    }),
  ]);
  promise.subscribe({
    reject: () => {
      log("call resolve a");
      subscriberA.resolve("a");
    },
  });
  vi.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "1000 ms passed",
      [
        "call reject b",
      ],
      [
        "call resolve a",
      ],
    ]
  `);
});

test("internally disposed when unsubscribed, a source resolve is ignored when internally disposed", () => {
  let subscriberA: InnerSubscriber<"a"> | undefined;
  let subscriberB: InnerSubscriber<"b"> | undefined;
  const promise = any([
    new LazyPromise<"a">((subscriber) => {
      log("produce a");
      subscriberA = subscriber;
      return () => {
        log("dispose a");
        subscriberB?.resolve("b");
      };
    }),
    new LazyPromise<"b">((subscriber) => {
      log("produce b");
      subscriberB = subscriber;
      return () => {
        log("dispose b");
        subscriberA?.resolve("a");
      };
    }),
  ]);
  promise.subscribe().unsubscribe();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "produce a",
      ],
      [
        "produce b",
      ],
      [
        "dispose a",
      ],
    ]
  `);
});
