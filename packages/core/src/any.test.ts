import { any, box, LazyPromise, never, TypedError } from "@lazy-promise/core";
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
  expectTypeOf(any([])).toEqualTypeOf<LazyPromise<TypedError<[]>>>();

  expectTypeOf(
    any([
      new LazyPromise<"value a">(() => {}),
      new LazyPromise<"value b">(() => {}),
    ]),
  ).toEqualTypeOf<LazyPromise<"value a" | "value b">>();

  expectTypeOf(
    any([
      new LazyPromise<TypedError<"error a">>(() => {}),
      new LazyPromise<TypedError<"error b">>(() => {}),
    ]),
  ).toEqualTypeOf<LazyPromise<TypedError<["error a", "error b"]>>>();

  expectTypeOf(
    any([
      new LazyPromise<"value a" | TypedError<"error a">>(() => {}),
      new LazyPromise<"value b" | TypedError<"error b">>(() => {}),
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

  expectTypeOf(
    any(
      new Set([new LazyPromise<"value a" | TypedError<"error a">>(() => {})]),
    ),
  ).toEqualTypeOf<LazyPromise<"value a" | TypedError<"error a"[]>>>();

  expectTypeOf(any(new Set([]))).toEqualTypeOf<LazyPromise<never>>();
});

test("empty iterable", () => {
  const promise = any([]);
  const unsubscribe = promise.subscribe((value) => {
    log("handleValue", value);
  });
  expect(unsubscribe).toMatchInlineSnapshot(`undefined`);
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

test("sync resolve", () => {
  const promise = any([
    box(new TypedError("a" as const)),
    box(new TypedError("b" as const)),
  ]);
  const unsubscribe = promise.subscribe((value) => {
    log("handleValue", value);
  });
  expect(unsubscribe).toMatchInlineSnapshot(`undefined`);
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

test("non-array iterable", () => {
  const promise = any(new Set([box(new TypedError("a"))]));
  promise.subscribe((value) => {
    log("handleValue", value);
  });
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

test("never", () => {
  const promise = any([never]);
  const unsubscribe = promise.subscribe();
  expect(unsubscribe).toMatchInlineSnapshot(`undefined`);
});

test("async resolve with typed errors", () => {
  const promise = any([
    new LazyPromise<TypedError<"a">>((resolve) => {
      setTimeout(() => {
        resolve(new TypedError("a"));
      }, 2000);
      return () => {};
    }),
    new LazyPromise<TypedError<"b">>((resolve) => {
      setTimeout(() => {
        resolve(new TypedError("b"));
      }, 1000);
      return () => {};
    }),
    box(new TypedError("c")),
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

test("resolving of one of the sources should resolve result", () => {
  const promise = any([
    new LazyPromise<"a">(() => () => {
      log("dispose a");
    }),
    new LazyPromise<"b">((resolve) => {
      setTimeout(() => {
        resolve("b");
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
    new LazyPromise((resolve, reject) => {
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

test("internally disposed when a source resolves, internal disposal should prevent further subscriptions to sources", () => {
  const promise = any([
    new LazyPromise<TypedError<string>>((resolve) => {
      log("produce a");
      setTimeout(() => {
        resolve(new TypedError("a"));
      }, 1000);
      return () => {
        log("dispose a");
      };
    }),
    box("b"),
    new LazyPromise<TypedError<string>>((resolve) => {
      log("produce c");
      setTimeout(() => {
        resolve(new TypedError("c"));
      }, 1000);
      return () => {
        log("dispose c");
      };
    }),
  ]);
  promise.subscribe((value) => {
    log("handleValue", value);
  });
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

test("internally disposed when a source resolves, a source resolve is ignored when internally disposed", () => {
  let resolveA: (value: "a") => void;
  const promise = any([
    new LazyPromise<"a">((resolve) => {
      log("produce a");
      resolveA = resolve;
      return () => {};
    }),
    new LazyPromise<"b">((resolve) => {
      setTimeout(() => {
        log("call resolve b");
        resolve("b");
      }, 1000);
      return () => {};
    }),
  ]);
  promise.subscribe(() => {
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
        "call resolve b",
      ],
      [
        "call resolve a",
      ],
    ]
  `);
});

test("internally disposed when a source resolves, a source reject is ignored when internally disposed", () => {
  let rejectA: (error: unknown) => void;
  const promise = any([
    new LazyPromise<"a">((resolve, reject) => {
      log("produce a");
      rejectA = reject;
      return () => {};
    }),
    new LazyPromise<"b">((resolve) => {
      setTimeout(() => {
        log("call resolve b");
        resolve("b");
      }, 1000);
      return () => {};
    }),
  ]);
  promise.subscribe(() => {
    log("call reject a");
    rejectA("oops");
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
  let resolveA: (value: "a") => void;
  const promise = any([
    new LazyPromise<"a">((resolve) => {
      resolveA = resolve;
      return () => {};
    }),
    new LazyPromise<never>((resolve, reject) => {
      setTimeout(() => {
        log("call reject b");
        reject("oops");
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
  let resolveA: ((value: "a") => void) | undefined;
  let resolveB: ((value: "b") => void) | undefined;
  const promise = any([
    new LazyPromise<"a">((resolve) => {
      log("produce a");
      resolveA = resolve;
      return () => {
        log("dispose a");
        resolveB?.("b");
      };
    }),
    new LazyPromise<"b">((resolve) => {
      log("produce b");
      resolveB = resolve;
      return () => {
        log("dispose b");
        resolveA?.("a");
      };
    }),
  ]);
  promise.subscribe()!();
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
