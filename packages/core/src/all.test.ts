import { all, box, LazyPromise, rejected } from "@lazy-promise/core";
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

  // $ExpectType LazyPromise<[], never>
  const promise1 = all([]);

  // $ExpectType LazyPromise<["value a", "value b"], "error a" | "error b">
  const promise2 = all([
    new LazyPromise<"value a", "error a">(() => {}),
    new LazyPromise<"value b", "error b">(() => {}),
  ]);

  // $ExpectType LazyPromise<never, "error a">
  const promise3 = all([
    new LazyPromise<"value a", "error a">(() => {}),
    new LazyPromise<never, never>(() => {}),
  ]);

  // $ExpectType LazyPromise<"value a"[], "error a">
  const promise4 = all(
    new Set([new LazyPromise<"value a", "error a">(() => {})]),
  );

  /* eslint-enable @typescript-eslint/no-unused-vars */
});

test("empty iterable", () => {
  const promise = all([]);
  promise.subscribe((value) => {
    log("handleValue", value);
  });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleValue",
        [],
      ],
    ]
  `);
});

test("sync resolve", () => {
  const promise = all([box("a" as const), box("b" as const)]);
  promise.subscribe((value) => {
    log("handleValue", value);
  });
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
    }),
    new LazyPromise<"b">((resolve) => {
      setTimeout(() => {
        resolve("b");
      }, 1000);
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

test("rejection of one of the sources should reject result", () => {
  const promise = all([
    new LazyPromise<"a">(() => () => {
      log("dispose a");
    }),
    new LazyPromise<"b", "oops">((resolve, reject) => {
      setTimeout(() => {
        reject("oops");
      }, 1000);
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

test("failure of one of the sources should fail result", () => {
  const promise = all([
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

test("internally disposed when a source rejects, a source resolve is ignored when internally disposed", () => {
  let resolveA: (value: "a") => void;
  const promise = all([
    new LazyPromise<"a">((resolve) => {
      log("produce a");
      resolveA = resolve;
    }),
    new LazyPromise<never, "b">((resolve, reject) => {
      setTimeout(() => {
        log("call reject b");
        reject("b");
      }, 1000);
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
    new LazyPromise<never, "a">((resolve, reject) => {
      log("produce a");
      rejectA = reject;
    }),
    new LazyPromise<never, "b">((resolve, reject) => {
      setTimeout(() => {
        log("call reject b");
        reject("b");
      }, 1000);
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

test("internally disposed when a source rejects, a source failure is ignored when internally disposed", () => {
  let failA: (error: unknown) => void;
  const promise = all([
    new LazyPromise<never, "a">((resolve, reject, fail) => {
      log("produce a");
      failA = fail;
    }),
    new LazyPromise<never, "b">((resolve, reject) => {
      setTimeout(() => {
        log("call reject b");
        reject("b");
      }, 1000);
    }),
  ]);
  promise.subscribe(undefined, () => {
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
        "call reject b",
      ],
      [
        "call fail a",
      ],
    ]
  `);
});

test("internally disposed when a source fails, a source reject is ignored when internally disposed", () => {
  let rejectA: (error: "oops 1") => void;
  const promise = all([
    new LazyPromise<never, "oops 1">((resolve, reject) => {
      rejectA = reject;
    }),
    new LazyPromise<never>((resolve, reject, fail) => {
      setTimeout(() => {
        log("call fail b");
        fail("oops 2");
      }, 1000);
    }),
  ]);
  promise.subscribe(
    undefined,
    () => {},
    () => {
      log("call reject a");
      rejectA("oops 1");
    },
  );
  vi.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "1000 ms passed",
      [
        "call fail b",
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
    new LazyPromise<never, "a">((resolve, reject) => {
      log("produce a");
      rejectA = reject;
      return () => {
        log("dispose a");
        rejectB?.("b");
      };
    }),
    new LazyPromise<never, "b">((resolve, reject) => {
      log("produce b");
      rejectB = reject;
      return () => {
        log("dispose b");
        rejectA?.("a");
      };
    }),
  ]);
  promise.subscribe(undefined, () => {})();
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
