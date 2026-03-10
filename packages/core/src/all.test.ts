import type { InnerSubscriber, Subscriber } from "@lazy-promise/core";
import {
  all,
  box,
  LazyPromise,
  rejecting,
  TypedError,
} from "@lazy-promise/core";
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
  expectTypeOf(all([])).toEqualTypeOf<LazyPromise<[]>>();

  expectTypeOf(
    all([
      new LazyPromise<"value a" | TypedError<"error a">>(() => {}),
      (true as boolean) ? "value b" : new TypedError("error b"),
    ]),
  ).toEqualTypeOf<
    LazyPromise<
      ["value a", "value b"] | TypedError<"error a"> | TypedError<"error b">
    >
  >();

  expectTypeOf(
    all([
      new LazyPromise<"value a" | TypedError<"error a">>(() => {}),
      new LazyPromise<never>(() => {}),
    ]),
  ).toEqualTypeOf<LazyPromise<TypedError<"error a">>>();

  expectTypeOf(all({})).toEqualTypeOf<LazyPromise<{}>>();

  expectTypeOf(
    all({
      a: new LazyPromise<"value a" | TypedError<"error a">>(() => {}),
      b: (true as boolean) ? "value b" : new TypedError("error b"),
    }),
  ).toEqualTypeOf<
    LazyPromise<
      | TypedError<"error a">
      | TypedError<"error b">
      | {
          readonly a: "value a";
          readonly b: "value b";
        }
    >
  >();

  expectTypeOf(
    all({
      a: new LazyPromise<"value a" | TypedError<"error a">>(() => {}),
      b: new LazyPromise<never>(() => {}),
    }),
  ).toEqualTypeOf<LazyPromise<TypedError<"error a">>>();

  expectTypeOf(all(new Set([]))).toEqualTypeOf<LazyPromise<never[]>>();

  expectTypeOf(
    all(
      new Set([
        new LazyPromise<"value a" | TypedError<"error a">>(() => {}),
        "value b" as const,
        new TypedError("error b"),
      ]),
    ),
  ).toEqualTypeOf<
    LazyPromise<
      TypedError<"error a"> | TypedError<"error b"> | ("value a" | "value b")[]
    >
  >();
});

test("empty iterable", () => {
  const promise = all([]);
  promise.subscribe(logSubscriber);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleValue",
        [],
      ],
    ]
  `);
});

test("empty object", () => {
  const promise = all({});
  promise.subscribe(logSubscriber);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleValue",
        {},
      ],
    ]
  `);
});

test("sync resolve (iterable)", () => {
  const promise = all([box("a"), "b"]);
  promise.subscribe(logSubscriber);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleValue",
        [
          "a",
          "b",
        ],
      ],
    ]
  `);
});

test("sync resolve (object)", () => {
  const promise = all({ a: box("a"), b: "b" });
  promise.subscribe(logSubscriber);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleValue",
        {
          "a": "a",
          "b": "b",
        },
      ],
    ]
  `);
});

test("non-array iterable", () => {
  const promise = all(new Set([box("a")]));
  promise.subscribe(logSubscriber);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleValue",
        [
          "a",
        ],
      ],
    ]
  `);
});

test("async resolve", () => {
  const promise = all([
    new LazyPromise<"a">((subscriber) => {
      setTimeout(() => {
        subscriber.resolve("a");
      }, 2000);
    }),
    new LazyPromise<"b">((subscriber) => {
      setTimeout(() => {
        subscriber.resolve("b");
      }, 1000);
    }),
    box("c" as const),
  ]);
  promise.subscribe(logSubscriber);
  vi.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "2000 ms passed",
      [
        "handleValue",
        [
          "a",
          "b",
          "c",
        ],
      ],
    ]
  `);
});

test("typed error passed as one of the sources should be passed on as result", () => {
  const promise = all(["a", new TypedError("oops")]);
  promise.subscribe(logSubscriber);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleValue",
        TypedError {
          "error": "oops",
        },
      ],
    ]
  `);
});

test("typed error emitted by one of the sources should be passed on as result", () => {
  const promise = all([
    new LazyPromise<"a">(() => () => {
      log("dispose a");
    }),
    new LazyPromise<"b" | TypedError<"oops">>((subscriber) => {
      setTimeout(() => {
        subscriber.resolve(new TypedError("oops"));
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
        TypedError {
          "error": "oops",
        },
      ],
      [
        "dispose a",
      ],
    ]
  `);
});

test("rejection of one of the sources should reject result", () => {
  const promise = all([
    new LazyPromise<"a">(() => () => {
      log("dispose a");
    }),
    new LazyPromise<"b">((subscriber) => {
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

test("internally disposed when a source in an iterable rejects, internal disposal should prevent further subscriptions to sources", () => {
  const promise = all([
    new LazyPromise<string>(() => {
      log("produce a");
      return () => {
        log("dispose a");
      };
    }),
    rejecting("b"),
    new LazyPromise<string>(() => {
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
        "handleError",
        "b",
      ],
      [
        "dispose a",
      ],
    ]
  `);
});

test("internally disposed when a source in an object rejects, internal disposal should prevent further subscriptions to sources", () => {
  const promise = all({
    a: new LazyPromise<string>(() => {
      log("produce a");
      return () => {
        log("dispose a");
      };
    }),
    b: rejecting("b"),
    c: new LazyPromise<string>(() => {
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
        "handleError",
        "b",
      ],
      [
        "dispose a",
      ],
    ]
  `);
});

test("unsubscribe", () => {
  const promise = all([
    new LazyPromise<"a">(() => {
      log("produce a");
      return () => {
        log("dispose a");
      };
    }),
    box("b" as const),
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

test("internally disposed when a source rejects, a source resolve is ignored when internally disposed", () => {
  let subscriberA: InnerSubscriber<"a">;
  const promise = all([
    new LazyPromise<"a">((subscriber) => {
      log("produce a");
      subscriberA = subscriber;
    }),
    new LazyPromise<never>((subscriber) => {
      setTimeout(() => {
        log("call reject b");
        subscriber.reject("b");
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
      [
        "produce a",
      ],
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

test("internally disposed when a source rejects, a source reject is ignored when internally disposed", () => {
  let subscriberA: InnerSubscriber<never>;
  const promise = all([
    new LazyPromise<never>((subscriber) => {
      log("produce a");
      subscriberA = subscriber;
    }),
    new LazyPromise<never>((subscriber) => {
      setTimeout(() => {
        log("call reject b");
        subscriber.reject("b");
      }, 1000);
    }),
  ]);
  promise.subscribe({
    reject: () => {
      log("call reject a");
      subscriberA.reject("a");
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
        "call reject b",
      ],
      [
        "call reject a",
      ],
    ]
  `);
});

test("internally disposed when unsubscribed, a source reject is ignored when internally disposed", () => {
  let subscriberA: InnerSubscriber<never> | undefined;
  let subscriberB: InnerSubscriber<never> | undefined;
  const promise = all([
    new LazyPromise<never>((subscriber) => {
      log("produce a");
      subscriberA = subscriber;
      return () => {
        log("dispose a");
        subscriberB?.reject("b");
      };
    }),
    new LazyPromise<never>((subscriber) => {
      log("produce b");
      subscriberB = subscriber;
      return () => {
        log("dispose b");
        subscriberA?.reject("a");
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
