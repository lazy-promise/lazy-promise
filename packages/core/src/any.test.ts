import { any, box, LazyPromise, rejected } from "@lazy-promise/core";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

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
  /* eslint-disable @typescript-eslint/no-unused-vars */

  // $ExpectType LazyPromise<never, []>
  const promise1 = any([]);

  // $ExpectType LazyPromise<"value a" | "value b", ["error a", "error b"]>
  const promise2 = any([
    new LazyPromise<"value a", "error a">(() => {}),
    new LazyPromise<"value b", "error b">(() => {}),
  ]);

  // $ExpectType LazyPromise<"value a", never>
  const promise3 = any([
    new LazyPromise<"value a", "error a">(() => {}),
    new LazyPromise<never, never>(() => {}),
  ]);

  // $ExpectType LazyPromise<"value a", "error a"[]>
  const promise4 = any(
    new Set([new LazyPromise<"value a", "error a">(() => {})]),
  );

  /* eslint-enable @typescript-eslint/no-unused-vars */
});

test("empty iterable", () => {
  const promise = any([]);
  promise.subscribe(undefined, (value) => {
    log("handleError", value);
  });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleError",
        [],
      ],
    ]
  `);
});

test("sync resolve", () => {
  const promise = any([rejected("a" as const), rejected("b" as const)]);
  promise.subscribe(undefined, (value) => {
    log("handleError", value);
  });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleError",
        [
          "a",
          "b",
        ],
      ],
    ]
  `);
});

test("non-array iterable", () => {
  const promise = any(new Set([rejected("a")]));
  promise.subscribe(undefined, (value) => {
    log("handleError", value);
  });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleError",
        [
          "a",
        ],
      ],
    ]
  `);
});

test("async reject", () => {
  const promise = any([
    new LazyPromise<never, "a">((resolve, reject) => {
      setTimeout(() => {
        reject("a");
      }, 2000);
    }),
    new LazyPromise<never, "b">((resolve, reject) => {
      setTimeout(() => {
        reject("b");
      }, 1000);
    }),
    rejected("c" as const),
  ]);
  promise.subscribe(undefined, (value) => {
    log("handleError", value);
  });
  vi.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "2000 ms passed",
      [
        "handleError",
        [
          "a",
          "b",
          "c",
        ],
      ],
    ]
  `);
});

test("resolving of one of the sources should resolve result", () => {
  const promise = any([
    new LazyPromise<"a">(() => () => {
      log("dispose a");
    }),
    new LazyPromise<"b", "oops">((resolve) => {
      setTimeout(() => {
        resolve("b");
      }, 1000);
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

test("failure of one of the sources should fail result", () => {
  const promise = any([
    new LazyPromise<"a">(() => () => {
      log("dispose a");
    }),
    new LazyPromise<"b", "oops">((resolve, reject, fail) => {
      setTimeout(() => {
        fail("oops");
      }, 1000);
    }),
  ]);
  promise.subscribe(
    undefined,
    () => {},
    (error) => {
      log("handleFailure", error);
    },
  );
  vi.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "1000 ms passed",
      [
        "handleFailure",
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
    new LazyPromise<undefined, string>((resolve, reject) => {
      log("produce a");
      setTimeout(() => {
        reject("a");
      }, 1000);
      return () => {
        log("dispose a");
      };
    }),
    box("b"),
    new LazyPromise<undefined, string>((resolve, reject) => {
      log("produce c");
      setTimeout(() => {
        reject("c");
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
    rejected("b" as const),
  ]);
  const dispose = promise.subscribe();
  vi.advanceTimersByTime(1000);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "produce a",
      ],
    ]
  `);
  dispose();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "1000 ms passed",
      [
        "dispose a",
      ],
    ]
  `);
});

test("internally disposed when a source resolves, a source reject is ignored when internally disposed", () => {
  let rejectA: (error: "a") => void;
  const promise = any([
    new LazyPromise<never, "a">((resolve, reject) => {
      log("produce a");
      rejectA = reject;
    }),
    new LazyPromise<"b">((resolve) => {
      setTimeout(() => {
        log("call resolve b");
        resolve("b");
      }, 1000);
    }),
  ]);
  promise.subscribe(() => {
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
        "call resolve b",
      ],
      [
        "call reject a",
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
    }),
    new LazyPromise<"b">((resolve) => {
      setTimeout(() => {
        log("call resolve b");
        resolve("b");
      }, 1000);
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

test("internally disposed when a source resolves, a source failure is ignored when internally disposed", () => {
  let failA: (error: unknown) => void;
  const promise = any([
    new LazyPromise<"a">((resolve, reject, fail) => {
      log("produce a");
      failA = fail;
    }),
    new LazyPromise<"b">((resolve) => {
      setTimeout(() => {
        log("call resolve b");
        resolve("b");
      }, 1000);
    }),
  ]);
  promise.subscribe(() => {
    log("call fail a");
    failA("oops");
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
        "call fail a",
      ],
    ]
  `);
});

test("internally disposed when a source fails, a source resolve is ignored when internally disposed", () => {
  let resolveA: (value: "a") => void;
  const promise = any([
    new LazyPromise<"a">((resolve) => {
      resolveA = resolve;
    }),
    new LazyPromise<never>((resolve, reject, fail) => {
      setTimeout(() => {
        log("call fail b");
        fail("oops");
      }, 1000);
    }),
  ]);
  promise.subscribe(undefined, undefined, () => {
    log("call resolve a");
    resolveA("a");
  });
  vi.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "1000 ms passed",
      [
        "call fail b",
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
  promise.subscribe()();
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
