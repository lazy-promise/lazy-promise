import { afterEach, beforeEach, expect, jest, test } from "@jest/globals";
import { any } from "./any";
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

  // $ExpectType LazyPromise<never, []>
  const promise1 = any([]);

  // $ExpectType LazyPromise<"value a" | "value b", ["error a", "error b"]>
  const promise2 = any([
    createLazyPromise<"value a", "error a">(() => {}),
    createLazyPromise<"value b", "error b">(() => {}),
  ]);

  // $ExpectType LazyPromise<"value a", never>
  const promise3 = any([
    createLazyPromise<"value a", "error a">(() => {}),
    createLazyPromise<never, never>(() => {}),
  ]);

  // $ExpectType LazyPromise<"value a", "error a"[]>
  const promise4 = any(
    new Set([createLazyPromise<"value a", "error a">(() => {})]),
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
    createLazyPromise<never, "a">((resolve, reject) => {
      setTimeout(() => {
        reject("a");
      }, 2000);
    }),
    createLazyPromise<never, "b">((resolve, reject) => {
      setTimeout(() => {
        reject("b");
      }, 1000);
    }),
    rejected("c" as const),
  ]);
  promise.subscribe(undefined, (value) => {
    log("handleError", value);
  });
  jest.runAllTimers();
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
    createLazyPromise<"a">(() => () => {
      log("dispose a");
    }),
    createLazyPromise<"b", "oops">((resolve) => {
      setTimeout(() => {
        resolve("b");
      }, 1000);
    }),
  ]);
  promise.subscribe((value) => {
    log("handleValue", value);
  });
  jest.runAllTimers();
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

test("internally disposed when a source resolves, internal disposal should prevent further subscriptions to sources", () => {
  const promise = any([
    createLazyPromise<undefined, string>((resolve, reject) => {
      log("produce a");
      setTimeout(() => {
        reject("a");
      }, 1000);
      return () => {
        log("dispose a");
      };
    }),
    resolved("b"),
    createLazyPromise<undefined, string>((resolve, reject) => {
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
    createLazyPromise<"a">(() => {
      log("produce a");
      return () => {
        log("dispose a");
      };
    }),
    rejected("b" as const),
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

test("internally disposed when a source resolves, a source reject is ignored when internally disposed", () => {
  let rejectA: (error: "a") => void;
  const promise = any([
    createLazyPromise<never, "a">((resolve, reject) => {
      log("produce a");
      rejectA = reject;
    }),
    createLazyPromise<"b">((resolve) => {
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
  jest.runAllTimers();
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
    createLazyPromise<"a">((resolve) => {
      log("produce a");
      resolveA = resolve;
    }),
    createLazyPromise<"b">((resolve) => {
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
  jest.runAllTimers();
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
  let failA: () => void;
  const promise = any([
    createLazyPromise<"a">((resolve, reject, fail) => {
      log("produce a");
      failA = fail;
    }),
    createLazyPromise<"b">((resolve) => {
      setTimeout(() => {
        log("call resolve b");
        resolve("b");
      }, 1000);
    }),
  ]);
  promise.subscribe(() => {
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
    createLazyPromise<"a">((resolve) => {
      resolveA = resolve;
    }),
    createLazyPromise<never>((resolve, reject, fail) => {
      setTimeout(() => {
        log("call fail b");
        fail();
      }, 1000);
    }),
  ]);
  promise.subscribe(undefined, undefined, () => {
    log("call resolve a");
    resolveA("a");
  });
  jest.runAllTimers();
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
    createLazyPromise<"a">((resolve) => {
      log("produce a");
      resolveA = resolve;
      return () => {
        log("dispose a");
        resolveB?.("b");
      };
    }),
    createLazyPromise<"b">((resolve) => {
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
