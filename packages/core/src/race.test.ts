import { box, LazyPromise, race, rejected } from "@lazy-promise/core";
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

test("empty iterable", () => {
  const promise = race([]);
  promise.subscribe(
    (value) => {
      log("handleValue", value);
    },
    (error) => {
      log("handleRejection", error);
    },
    () => {
      log("handleFailure");
    },
  );
  expect(readLog()).toMatchInlineSnapshot(`[]`);
});

test("sync resolve", () => {
  const promise = race([
    new LazyPromise<never>(() => {
      log("produce a");
      return () => {
        log("dispose a");
      };
    }),
    box("b" as const),
    new LazyPromise<never>(() => {
      log("produce c");
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

test("non-array iterable", () => {
  const promise = race(new Set([box("a")]));
  promise.subscribe((value) => {
    log("resolve", value);
  });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "resolve",
        "a",
      ],
    ]
  `);
});

test("async resolve", () => {
  const promise = race([
    new LazyPromise<"a">((resolve) => {
      const timeoutId = setTimeout(() => {
        resolve("a");
      }, 1000);
      return () => {
        log("dispose a");
        clearTimeout(timeoutId);
      };
    }),
    new LazyPromise<"b">((resolve) => {
      const timeoutId = setTimeout(() => {
        resolve("b");
      }, 2000);
      return () => {
        log("dispose b");
        clearTimeout(timeoutId);
      };
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
        "a",
      ],
      [
        "dispose b",
      ],
    ]
  `);
});

test("sync error", () => {
  const promise = race([
    new LazyPromise<never>(() => {
      log("produce a");
      return () => {
        log("dispose a");
      };
    }),
    rejected("b" as const),
    new LazyPromise<never>(() => {
      log("produce c");
      return () => {
        log("dispose c");
      };
    }),
  ]);
  promise.subscribe(undefined, (error) => {
    log("handleRejection", error);
  });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "produce a",
      ],
      [
        "handleRejection",
        "b",
      ],
      [
        "dispose a",
      ],
    ]
  `);
});

test("async error", () => {
  const promise = race([
    new LazyPromise<never, "a">((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject("a");
      }, 1000);
      return () => {
        log("dispose a");
        clearTimeout(timeoutId);
      };
    }),
    new LazyPromise<"b">((resolve) => {
      const timeoutId = setTimeout(() => {
        resolve("b");
      }, 2000);
      return () => {
        log("dispose b");
        clearTimeout(timeoutId);
      };
    }),
  ]);
  promise.subscribe(undefined, (error) => {
    log("handleRejection", error);
  });
  vi.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "1000 ms passed",
      [
        "handleRejection",
        "a",
      ],
      [
        "dispose b",
      ],
    ]
  `);
});

test("unsubscribe", () => {
  const promise = race([
    new LazyPromise(() => {
      log("produce a");
      return () => {
        log("dispose a");
      };
    }),
    new LazyPromise(() => {
      log("produce b");
      return () => {
        log("dispose b");
      };
    }),
  ]);
  const dispose = promise.subscribe();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "produce a",
      ],
      [
        "produce b",
      ],
    ]
  `);
  dispose();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "dispose a",
      ],
      [
        "dispose b",
      ],
    ]
  `);
});

test("internally disposed when a source resolves, a source resolve is ignored when internally disposed", () => {
  let resolveA: (value: "a") => void;
  const promise = race([
    new LazyPromise<"a">((resolve) => {
      resolveA = resolve;
      return () => {};
    }),
    new LazyPromise<"b">((resolve) => {
      setTimeout(() => {
        log("resolve b");
        resolve("b");
      }, 1000);
      return () => {};
    }),
  ]);
  promise.subscribe((value) => {
    log("handleValue", value);
    log("resolve a");
    resolveA("a");
  });
  vi.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "1000 ms passed",
      [
        "resolve b",
      ],
      [
        "handleValue",
        "b",
      ],
      [
        "resolve a",
      ],
    ]
  `);
});

test("internally disposed when a source rejects, a source resolve is ignored when internally disposed", () => {
  let resolveA: (value: "a") => void;
  const promise = race([
    new LazyPromise<"a">((resolve) => {
      resolveA = resolve;
      return () => {};
    }),
    new LazyPromise<never, "b">((resolve, reject) => {
      setTimeout(() => {
        log("reject b");
        reject("b");
      }, 1000);
      return () => {};
    }),
  ]);
  promise.subscribe(undefined, (error) => {
    log("handleRejection", error);
    log("resolve a");
    resolveA("a");
  });
  vi.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "1000 ms passed",
      [
        "reject b",
      ],
      [
        "handleRejection",
        "b",
      ],
      [
        "resolve a",
      ],
    ]
  `);
});

test("internally disposed when a source fails, a source resolve is ignored when internally disposed", () => {
  let resolveA: (value: "a") => void;
  const promise = race([
    new LazyPromise<"a">((resolve) => {
      resolveA = resolve;
      return () => {};
    }),
    new LazyPromise<never>((resolve, reject, fail) => {
      setTimeout(() => {
        log("fail b");
        fail("oops");
      }, 1000);
      return () => {};
    }),
  ]);
  promise.subscribe(undefined, undefined, (error) => {
    log("handleFailure", error);
    log("resolve a");
    resolveA("a");
  });
  vi.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "1000 ms passed",
      [
        "fail b",
      ],
      [
        "handleFailure",
        "oops",
      ],
      [
        "resolve a",
      ],
    ]
  `);
});

test("internally disposed when a source resolves, a source reject is ignored when internally disposed", () => {
  let rejectA: (error: "a") => void;
  const promise = race([
    new LazyPromise<never, "a">((resolve, reject) => {
      rejectA = reject;
      return () => {};
    }),
    new LazyPromise<"b">((resolve) => {
      setTimeout(() => {
        log("resolve b");
        resolve("b");
      }, 1000);
      return () => {};
    }),
  ]);
  promise.subscribe(
    (value) => {
      log("handleValue", value);
      log("reject a");
      rejectA("a");
    },
    () => {},
  );
  vi.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "1000 ms passed",
      [
        "resolve b",
      ],
      [
        "handleValue",
        "b",
      ],
      [
        "reject a",
      ],
    ]
  `);
});

test("internally disposed when a source resolves, a source failure is ignored when internally disposed", () => {
  let failA: (error: unknown) => void;
  const promise = race([
    new LazyPromise<never>((resolve, reject, fail) => {
      failA = fail;
      return () => {};
    }),
    new LazyPromise<"b">((resolve) => {
      setTimeout(() => {
        log("resolve b");
        resolve("b");
      }, 1000);
      return () => {};
    }),
  ]);
  promise.subscribe((value) => {
    log("handleValue", value);
    log("fail a");
    failA("oops");
  });
  vi.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "1000 ms passed",
      [
        "resolve b",
      ],
      [
        "handleValue",
        "b",
      ],
      [
        "fail a",
      ],
    ]
  `);
});

test("internally disposed by the teardown function, a source resolve is ignored when internally disposed", () => {
  let resolveA: ((value: "a") => void) | undefined;
  let resolveB: ((value: "b") => void) | undefined;
  const promise = race([
    new LazyPromise<"a">((resolve) => {
      log("produce a");
      resolveA = resolve;
      return () => {
        log("dispose a");
        resolveA = undefined;
        resolveB?.("b");
      };
    }),
    new LazyPromise<"b">((resolve) => {
      log("produce b");
      resolveB = resolve;
      return () => {
        log("dispose b");
        resolveB = undefined;
        resolveA?.("a");
      };
    }),
  ]);
  promise.subscribe(
    (value) => {
      log("handleValue", value);
    },
    (error) => {
      log("handleRejection", error);
    },
    () => {
      log("handleFailure");
    },
  )();
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
