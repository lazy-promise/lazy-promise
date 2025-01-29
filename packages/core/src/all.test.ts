import { afterEach, beforeEach, expect, jest, test } from "@jest/globals";
import { all } from "./all";
import { createLazyPromise, rejected, resolved } from "./lazyPromise";

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
  jest.useFakeTimers();
  logTime = Date.now();
  global.queueMicrotask = (task) => mockMicrotaskQueue.push(task);
});

afterEach(() => {
  processMockMicrotaskQueue();
  global.queueMicrotask = originalQueueMicrotask;
  jest.useRealTimers();
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
    createLazyPromise<"value a", "error a">(() => {}),
    createLazyPromise<"value b", "error b">(() => {}),
  ]);

  // $ExpectType LazyPromise<never, "error a">
  const promise3 = all([
    createLazyPromise<"value a", "error a">(() => {}),
    createLazyPromise<never, never>(() => {}),
  ]);

  // $ExpectType LazyPromise<"value a"[], "error a">
  const promise4 = all(
    new Set([createLazyPromise<"value a", "error a">(() => {})]),
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
  const promise = all([resolved("a" as const), resolved("b" as const)]);
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
  const promise = all(new Set([resolved("a")]));
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
    createLazyPromise<"a">((resolve) => {
      setTimeout(() => {
        resolve("a");
      }, 2000);
    }),
    createLazyPromise<"b">((resolve) => {
      setTimeout(() => {
        resolve("b");
      }, 1000);
    }),
    resolved("c" as const),
  ]);
  promise.subscribe((value) => {
    log("handleValue", value);
  });
  jest.runAllTimers();
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
    createLazyPromise<"a">(() => () => {
      log("dispose a");
    }),
    createLazyPromise<"b", "oops">((resolve, reject) => {
      setTimeout(() => {
        reject("oops");
      }, 1000);
    }),
  ]);
  promise.subscribe(undefined, (error) => {
    log("handleError", error);
  });
  jest.runAllTimers();
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
    createLazyPromise<"a">(() => () => {
      log("dispose a");
    }),
    createLazyPromise<"b", "oops">((resolve, reject, fail) => {
      setTimeout(() => {
        fail();
      }, 1000);
    }),
  ]);
  promise.subscribe(
    undefined,
    () => {},
    () => {
      log("handleFailure");
    },
  );
  jest.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "1000 ms passed",
      [
        "handleFailure",
      ],
      [
        "dispose a",
      ],
    ]
  `);
});

test("internally disposed when a source rejects, internal disposal should prevent further subscriptions to sources", () => {
  const promise = all([
    createLazyPromise<string>((resolve) => {
      log("produce a");
      setTimeout(() => {
        resolve("a");
      }, 1000);
      return () => {
        log("dispose a");
      };
    }),
    rejected("b"),
    createLazyPromise<string>((resolve) => {
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
    createLazyPromise<"a">(() => {
      log("produce a");
      return () => {
        log("dispose a");
      };
    }),
    resolved("b" as const),
  ]);
  const dispose = promise.subscribe();
  jest.advanceTimersByTime(1000);
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
    createLazyPromise<"a">((resolve) => {
      log("produce a");
      resolveA = resolve;
    }),
    createLazyPromise<never, "b">((resolve, reject) => {
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
  jest.runAllTimers();
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
    createLazyPromise<never, "a">((resolve, reject) => {
      log("produce a");
      rejectA = reject;
    }),
    createLazyPromise<never, "b">((resolve, reject) => {
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
  jest.runAllTimers();
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
  let failA: () => void;
  const promise = all([
    createLazyPromise<never, "a">((resolve, reject, fail) => {
      log("produce a");
      failA = fail;
    }),
    createLazyPromise<never, "b">((resolve, reject) => {
      setTimeout(() => {
        log("call reject b");
        reject("b");
      }, 1000);
    }),
  ]);
  promise.subscribe(undefined, () => {
    log("call fail a");
    failA();
  });
  jest.runAllTimers();
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
  let rejectA: (error: "oops") => void;
  const promise = all([
    createLazyPromise<never, "oops">((resolve, reject) => {
      rejectA = reject;
    }),
    createLazyPromise<never>((resolve, reject, fail) => {
      setTimeout(() => {
        log("call fail b");
        fail();
      }, 1000);
    }),
  ]);
  promise.subscribe(
    undefined,
    () => {},
    () => {
      log("call reject a");
      rejectA("oops");
    },
  );
  jest.runAllTimers();
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
    createLazyPromise<never, "a">((resolve, reject) => {
      log("produce a");
      rejectA = reject;
      return () => {
        log("dispose a");
        rejectB?.("b");
      };
    }),
    createLazyPromise<never, "b">((resolve, reject) => {
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
