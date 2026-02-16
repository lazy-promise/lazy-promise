import {
  all,
  box,
  LazyPromise,
  never,
  rejected,
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
      new LazyPromise<"value a">(() => {}),
      new LazyPromise<"value b">(() => {}),
    ]),
  ).toEqualTypeOf<LazyPromise<["value a", "value b"]>>();

  expectTypeOf(
    all([
      new LazyPromise<"value a" | TypedError<"error a">>(() => {}),
      new LazyPromise<"value b" | TypedError<"error b">>(() => {}),
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

  expectTypeOf(
    all(
      new Set([new LazyPromise<"value a" | TypedError<"error a">>(() => {})]),
    ),
  ).toEqualTypeOf<LazyPromise<TypedError<"error a"> | "value a"[]>>();

  expectTypeOf(all(new Set([]))).toEqualTypeOf<LazyPromise<never[]>>();
});

test("empty iterable", () => {
  const promise = all([]);
  const unsubscribe = promise.subscribe((value) => {
    log("handleValue", value);
  });
  expect(unsubscribe).toMatchInlineSnapshot(`undefined`);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleValue",
        [],
      ],
    ]
  `);
});

test("never", () => {
  const promise = all([never]);
  const unsubscribe = promise.subscribe();
  expect(unsubscribe).toMatchInlineSnapshot(`undefined`);
});

test("sync resolve", () => {
  const promise = all([box("a" as const), box("b" as const)]);
  const unsubscribe = promise.subscribe((value) => {
    log("handleValue", value);
  });
  expect(unsubscribe).toMatchInlineSnapshot(`undefined`);
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

test("non-array iterable", () => {
  const promise = all(new Set([box("a")]));
  promise.subscribe((value) => {
    log("handleValue", value);
  });
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
    new LazyPromise<"a">((resolve) => {
      setTimeout(() => {
        resolve("a");
      }, 2000);
      return () => {};
    }),
    new LazyPromise<"b">((resolve) => {
      setTimeout(() => {
        resolve("b");
      }, 1000);
      return () => {};
    }),
    box("c" as const),
  ]);
  promise.subscribe((value) => {
    log("handleValue", value);
  });
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

test("typed error from of one of the sources should be passed on as result", () => {
  const promise = all([
    new LazyPromise<"a">(() => () => {
      log("dispose a");
    }),
    new LazyPromise<"b" | TypedError<"oops">>((resolve) => {
      setTimeout(() => {
        resolve(new TypedError("oops"));
      }, 1000);
      return () => {};
    }),
  ]);
  promise.subscribe((value) => {
    log("handleValue", value);
  });
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
    new LazyPromise<"b">((resolve, reject) => {
      setTimeout(() => {
        reject("oops");
      }, 1000);
      return () => {};
    }),
  ]);
  promise.subscribe(undefined, (error) => {
    log("handleError", error);
  });
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

test("internally disposed when a source rejects, internal disposal should prevent further subscriptions to sources", () => {
  const promise = all([
    new LazyPromise<string>((resolve) => {
      log("produce a");
      setTimeout(() => {
        resolve("a");
      }, 1000);
      return () => {
        log("dispose a");
      };
    }),
    rejected("b"),
    new LazyPromise<string>((resolve) => {
      log("produce c");
      setTimeout(() => {
        resolve("c");
      }, 1000);
      return () => {
        log("dispose c");
      };
    }),
  ]);
  promise.subscribe(undefined, (error) => {
    log("handleError", error);
  });
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
  const unsubscribe = promise.subscribe();
  vi.advanceTimersByTime(1000);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "produce a",
      ],
    ]
  `);
  unsubscribe!();
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
  let resolveA: (value: "a") => void;
  const promise = all([
    new LazyPromise<"a">((resolve) => {
      log("produce a");
      resolveA = resolve;
      return () => {};
    }),
    new LazyPromise<never>((resolve, reject) => {
      setTimeout(() => {
        log("call reject b");
        reject("b");
      }, 1000);
      return () => {};
    }),
  ]);
  promise.subscribe(undefined, () => {
    log("call resolve a");
    resolveA("a");
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
  let rejectA: (error: "a") => void;
  const promise = all([
    new LazyPromise<never>((resolve, reject) => {
      log("produce a");
      rejectA = reject;
      return () => {};
    }),
    new LazyPromise<never>((resolve, reject) => {
      setTimeout(() => {
        log("call reject b");
        reject("b");
      }, 1000);
      return () => {};
    }),
  ]);
  promise.subscribe(undefined, () => {
    log("call reject a");
    rejectA("a");
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
  let rejectA: ((error: "a") => void) | undefined;
  let rejectB: ((error: "b") => void) | undefined;
  const promise = all([
    new LazyPromise<never>((resolve, reject) => {
      log("produce a");
      rejectA = reject;
      return () => {
        log("dispose a");
        rejectB?.("b");
      };
    }),
    new LazyPromise<never>((resolve, reject) => {
      log("produce b");
      rejectB = reject;
      return () => {
        log("dispose b");
        rejectA?.("a");
      };
    }),
  ]);
  promise.subscribe(undefined, () => {})!();
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
