import { afterEach, beforeEach, expect, jest, test } from "@jest/globals";
import { createLazyPromise, rejected, resolved } from "./lazyPromise";
import { race } from "./race";

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

test("empty iterable", () => {
  const promise = race([]);
  promise.subscribe(
    (value) => {
      log("handleValue", value);
    },
    (error) => {
      log("handleError", error);
    },
    () => {
      log("handleFailure");
    },
  );
  expect(readLog()).toMatchInlineSnapshot(`[]`);
});

test("sync resolve", () => {
  const promise = race([
    createLazyPromise<never>(() => {
      log("produce a");
      return () => {
        log("dispose a");
      };
    }),
    resolved("b" as const),
    createLazyPromise<never>(() => {
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
  const promise = race(new Set([resolved("a")]));
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
    createLazyPromise<"a">((resolve) => {
      const timeoutId = setTimeout(() => {
        resolve("a");
      }, 1000);
      return () => {
        log("dispose a");
        clearTimeout(timeoutId);
      };
    }),
    createLazyPromise<"b">((resolve) => {
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
  jest.runAllTimers();
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
    createLazyPromise<never>(() => {
      log("produce a");
      return () => {
        log("dispose a");
      };
    }),
    rejected("b" as const),
    createLazyPromise<never>(() => {
      log("produce c");
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

test("async error", () => {
  const promise = race([
    createLazyPromise<never, "a">((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject("a");
      }, 1000);
      return () => {
        log("dispose a");
        clearTimeout(timeoutId);
      };
    }),
    createLazyPromise<"b">((resolve) => {
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
    log("handleError", error);
  });
  jest.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "1000 ms passed",
      [
        "handleError",
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
    createLazyPromise(() => {
      log("produce a");
      return () => {
        log("dispose a");
      };
    }),
    createLazyPromise(() => {
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
    createLazyPromise<"a">((resolve) => {
      resolveA = resolve;
    }),
    createLazyPromise<"b">((resolve) => {
      setTimeout(() => {
        log("resolve b");
        resolve("b");
      }, 1000);
    }),
  ]);
  promise.subscribe((value) => {
    log("handleValue", value);
    log("resolve a");
    resolveA("a");
  });
  jest.runAllTimers();
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
    createLazyPromise<"a">((resolve) => {
      resolveA = resolve;
    }),
    createLazyPromise<never, "b">((resolve, reject) => {
      setTimeout(() => {
        log("reject b");
        reject("b");
      }, 1000);
    }),
  ]);
  promise.subscribe(undefined, (error) => {
    log("handleError", error);
    log("resolve a");
    resolveA("a");
  });
  jest.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "1000 ms passed",
      [
        "reject b",
      ],
      [
        "handleError",
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
    createLazyPromise<"a">((resolve) => {
      resolveA = resolve;
    }),
    createLazyPromise<never>((resolve, reject, fail) => {
      setTimeout(() => {
        log("fail b");
        fail();
      }, 1000);
    }),
  ]);
  promise.subscribe(undefined, undefined, () => {
    log("handleFailure");
    log("resolve a");
    resolveA("a");
  });
  jest.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "1000 ms passed",
      [
        "fail b",
      ],
      [
        "handleFailure",
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
    createLazyPromise<never, "a">((resolve, reject) => {
      rejectA = reject;
    }),
    createLazyPromise<"b">((resolve) => {
      setTimeout(() => {
        log("resolve b");
        resolve("b");
      }, 1000);
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
  jest.runAllTimers();
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
  let failA: () => void;
  const promise = race([
    createLazyPromise<never>((resolve, reject, fail) => {
      failA = fail;
    }),
    createLazyPromise<"b">((resolve) => {
      setTimeout(() => {
        log("resolve b");
        resolve("b");
      }, 1000);
    }),
  ]);
  promise.subscribe((value) => {
    log("handleValue", value);
    log("fail a");
    failA();
  });
  jest.runAllTimers();
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
    createLazyPromise<"a">((resolve) => {
      log("produce a");
      resolveA = resolve;
      return () => {
        log("dispose a");
        resolveA = undefined;
        resolveB?.("b");
      };
    }),
    createLazyPromise<"b">((resolve) => {
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
      log("handleError", error);
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
