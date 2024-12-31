import { afterEach, beforeEach, expect, jest, test } from "@jest/globals";
import {
  createLazyPromise,
  isLazyPromise,
  never,
  rejected,
  resolved,
} from "./lazyPromise";

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

test("async resolve", () => {
  const promise = createLazyPromise<string>((resolve) => {
    setTimeout(() => {
      resolve("value");
    }, 1000);
  });
  promise.subscribe((value) => {
    log("resolve", value);
  });
  jest.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "1000 ms passed",
      [
        "resolve",
        "value",
      ],
    ]
  `);
});

test("sync resolve", () => {
  const promise = createLazyPromise<string>((resolve) => {
    log("produce");
    resolve("value");
  });
  promise.subscribe((value) => {
    log("resolve", value);
  });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "produce",
      ],
      [
        "resolve",
        "value",
      ],
    ]
  `);
  promise.subscribe((value) => {
    log("resolve", value);
  });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "resolve",
        "value",
      ],
    ]
  `);
});

test("async reject", () => {
  const promise = createLazyPromise<unknown, string>((_, reject) => {
    setTimeout(() => {
      reject("oops");
    }, 1000);
  });
  promise.subscribe(undefined, (error) => {
    log("reject", error);
  });
  jest.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "1000 ms passed",
      [
        "reject",
        "oops",
      ],
    ]
  `);
});

test("sync reject", () => {
  const promise = createLazyPromise<unknown, string>((_, reject) => {
    log("produce");
    reject("oops");
  });
  promise.subscribe(undefined, (error) => {
    log("reject", error);
  });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "produce",
      ],
      [
        "reject",
        "oops",
      ],
    ]
  `);
  promise.subscribe(undefined, (error) => {
    log("reject", error);
  });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "reject",
        "oops",
      ],
    ]
  `);
});

test("cancellation", () => {
  const promise = createLazyPromise<string>(() => {
    log("produce");
    return () => {
      log("dispose");
    };
  });
  const a = promise.subscribe();
  const b = promise.subscribe();
  const c = promise.subscribe();
  a();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "produce",
      ],
    ]
  `);
  a();
  expect(readLog()).toMatchInlineSnapshot(`[]`);
  b();
  expect(readLog()).toMatchInlineSnapshot(`[]`);
  b();
  expect(readLog()).toMatchInlineSnapshot(`[]`);
  c();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "dispose",
      ],
    ]
  `);
  c();
  // At this point we could also have a GC test to make sure the teardown
  // function is no longer referenced.
  expect(readLog()).toMatchInlineSnapshot(`[]`);
  const d = promise.subscribe();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "produce",
      ],
    ]
  `);
  d();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "dispose",
      ],
    ]
  `);
});

test("teardown function is not called if the lazy promise resolves", () => {
  const promise = createLazyPromise<number>((resolve) => {
    setTimeout(() => {
      resolve(1);
    }, 1000);
    return () => {
      log("dispose");
    };
  });
  const dispose = promise.subscribe();
  jest.runAllTimers();
  dispose();
  expect(readLog()).toMatchInlineSnapshot(`[]`);
});

test("teardown function is not called if the lazy promise rejects", () => {
  const promise = createLazyPromise<number, number>((_, reject) => {
    setTimeout(() => {
      reject(1);
    }, 1000);
    return () => {
      log("dispose");
    };
  });
  const dispose = promise.subscribe(undefined, () => {});
  jest.runAllTimers();
  dispose();
  expect(readLog()).toMatchInlineSnapshot(`[]`);
});

test("teardown function called by consumer", () => {
  const promise = createLazyPromise<"a">((resolve) => {
    setTimeout(() => {
      resolve("a");
    }, 1000);
    return () => {
      log("dispose");
    };
  });
  const dispose = promise.subscribe(() => {
    dispose();
    log("resolve");
  });
  jest.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "1000 ms passed",
      [
        "resolve",
      ],
    ]
  `);
});

test("error in produce function", () => {
  const promise = createLazyPromise(() => {
    throw "oops";
  });
  promise.subscribe();
  expect(processMockMicrotaskQueue).toThrow("oops");
});

test("error in teardown function", () => {
  const promise = createLazyPromise(() => () => {
    throw "oops";
  });
  promise.subscribe()();
  expect(processMockMicrotaskQueue).toThrow("oops");
});

test("error in resolve consumer function", () => {
  const promise = createLazyPromise<string>((resolve) => {
    setTimeout(() => {
      resolve("value");
    }, 1000);
  });
  promise.subscribe(() => {
    throw "oops";
  });
  promise.subscribe((value) => {
    log("resolve", value);
  });
  jest.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "1000 ms passed",
      [
        "resolve",
        "value",
      ],
    ]
  `);
  expect(processMockMicrotaskQueue).toThrow("oops");
  promise.subscribe(() => {
    throw "oops";
  });
  expect(processMockMicrotaskQueue).toThrow("oops");
});

test("error in reject consumer function", () => {
  const promise = createLazyPromise<string, string>((_, reject) => {
    setTimeout(() => {
      reject("error");
    }, 1000);
  });
  promise.subscribe(undefined, () => {
    throw "oops";
  });
  promise.subscribe(undefined, (error) => {
    log("reject", error);
  });
  jest.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "1000 ms passed",
      [
        "reject",
        "error",
      ],
    ]
  `);
  expect(processMockMicrotaskQueue).toThrow("oops");
  promise.subscribe(undefined, () => {
    throw "oops";
  });
  expect(processMockMicrotaskQueue).toThrow("oops");
});

test("unhandled rejection", () => {
  const promise = createLazyPromise<unknown, string>((_, reject) => {
    setTimeout(() => {
      reject("oops");
    }, 1000);
  });
  // @ts-expect-error
  promise.subscribe();

  // Make sure there is a type error in all cases.
  // @ts-expect-error
  promise.subscribe(undefined);
  // @ts-expect-error
  promise.subscribe(undefined, undefined);
  // @ts-expect-error
  promise.subscribe(() => {});
  // @ts-expect-error
  promise.subscribe(() => {}, undefined);

  expect(mockMicrotaskQueue.length).toMatchInlineSnapshot(`0`);
  jest.runAllTimers();
  expect(processMockMicrotaskQueue).toThrow("oops");
  // Only one error is thrown.
  processMockMicrotaskQueue();
  // @ts-expect-error
  promise.subscribe();
  expect(processMockMicrotaskQueue).toThrow("oops");
});

test("already resolved", () => {
  const promise = createLazyPromise<number, number>((resolve, reject) => {
    resolve(1);
    try {
      resolve(2);
    } catch (error) {
      log("resolve error", error);
    }
    try {
      reject(1);
    } catch (error) {
      log("reject error", error);
    }
  });
  promise.subscribe(undefined, () => {});
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "resolve error",
        [Error: You cannot resolve or reject a lazy promise that was already resolved or rejected.],
      ],
      [
        "reject error",
        [Error: You cannot resolve or reject a lazy promise that was already resolved or rejected.],
      ],
    ]
  `);
});

test("already rejected", () => {
  const promise = createLazyPromise<number, number>((resolve, reject) => {
    reject(1);
    try {
      resolve(1);
    } catch (error) {
      log("resolve error", error);
    }
    try {
      reject(2);
    } catch (error) {
      log("reject error", error);
    }
  });
  promise.subscribe(undefined, () => {});
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "resolve error",
        [Error: You cannot resolve or reject a lazy promise that was already resolved or rejected.],
      ],
      [
        "reject error",
        [Error: You cannot resolve or reject a lazy promise that was already resolved or rejected.],
      ],
    ]
  `);
});

test("no subscribers", () => {
  const promise = createLazyPromise<number, number>((resolve, reject) => {
    setTimeout(() => {
      try {
        resolve(1);
      } catch (error) {
        log("resolve error", error);
      }
      try {
        reject(1);
      } catch (error) {
        log("reject error", error);
      }
    });
  });
  promise.subscribe(undefined, () => {})();
  jest.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "resolve error",
        [Error: You cannot resolve or reject a lazy promise that no longer has any subscribers. Make sure that when you create the promise using createLazyPromise, you return a working teardown function.],
      ],
      [
        "reject error",
        [Error: You cannot resolve or reject a lazy promise that no longer has any subscribers. Make sure that when you create the promise using createLazyPromise, you return a working teardown function.],
      ],
    ]
  `);
});

test("resolved", () => {
  const promise = resolved(1);
  expect(isLazyPromise(promise)).toMatchInlineSnapshot(`true`);
  promise.subscribe((value) => {
    log("resolved", value);
  })();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "resolved",
        1,
      ],
    ]
  `);
  promise.subscribe(() => {
    throw "oops";
  })();
  expect(processMockMicrotaskQueue).toThrow("oops");
});

test("rejected", () => {
  const promise = rejected("error");
  expect(isLazyPromise(promise)).toMatchInlineSnapshot(`true`);
  promise.subscribe(undefined, (error) => {
    log("rejected", error);
  })();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "rejected",
        "error",
      ],
    ]
  `);
  promise.subscribe(undefined, () => {
    throw "oops";
  })();
  expect(processMockMicrotaskQueue).toThrow("oops");
  // @ts-expect-error
  const dispose = promise.subscribe();
  dispose();
  expect(processMockMicrotaskQueue).toThrow("error");
});

test("never", () => {
  expect(isLazyPromise(never)).toMatchInlineSnapshot(`true`);
  never.subscribe(
    () => {
      log("resolve");
    },
    () => {
      log("reject");
    },
  )();
  expect(readLog()).toMatchInlineSnapshot(`[]`);
});

test("isLazyPromise", () => {
  expect(isLazyPromise(undefined)).toMatchInlineSnapshot(`false`);
  expect(isLazyPromise(null)).toMatchInlineSnapshot(`false`);
  expect(isLazyPromise(() => {})).toMatchInlineSnapshot(`false`);
  expect(isLazyPromise(createLazyPromise(() => {}))).toMatchInlineSnapshot(
    `true`,
  );
});
