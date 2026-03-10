import type { InnerSubscriber, Subscriber } from "@lazy-promise/core";
import { box, LazyPromise, never, race, rejecting } from "@lazy-promise/core";
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

test("empty iterable", () => {
  const promise = race([]);
  promise.subscribe(logSubscriber);
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
    }),
  ]);
  promise.subscribe(logSubscriber);
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

test("value as one of the sources", () => {
  const promise = race([
    new LazyPromise<never>(() => {
      log("produce a");
      return () => {
        log("dispose a");
      };
    }),
    "b",
    new LazyPromise<never>(() => {
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
  promise.subscribe(logSubscriber);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleValue",
        "a",
      ],
    ]
  `);
});

test("never", () => {
  const promise = race([never]);
  promise.subscribe();
});

test("async resolve", () => {
  const promise = race([
    new LazyPromise<"a">((subscriber) => {
      const timeoutId = setTimeout(() => {
        subscriber.resolve("a");
      }, 1000);
      return () => {
        log("dispose a");
        clearTimeout(timeoutId);
      };
    }),
    new LazyPromise<"b">((subscriber) => {
      const timeoutId = setTimeout(() => {
        subscriber.resolve("b");
      }, 2000);
      return () => {
        log("dispose b");
        clearTimeout(timeoutId);
      };
    }),
  ]);
  promise.subscribe(logSubscriber);
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
    rejecting("b" as const),
    new LazyPromise<never>(() => {
      log("produce c");
      return () => {
        log("dispose c");
      };
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

test("async error", () => {
  const promise = race([
    new LazyPromise<never>((subscriber) => {
      const timeoutId = setTimeout(() => {
        subscriber.reject("a");
      }, 1000);
      return () => {
        log("dispose a");
        clearTimeout(timeoutId);
      };
    }),
    new LazyPromise<"b">((subscriber) => {
      const timeoutId = setTimeout(() => {
        subscriber.resolve("b");
      }, 2000);
      return () => {
        log("dispose b");
        clearTimeout(timeoutId);
      };
    }),
  ]);
  promise.subscribe(logSubscriber);
  vi.runAllTimers();
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
    new LazyPromise<never>(() => {
      log("produce a");
      return () => {
        log("dispose a");
      };
    }),
    new LazyPromise<never>(() => {
      log("produce b");
      return () => {
        log("dispose b");
      };
    }),
  ]);
  const subscription = promise.subscribe();
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
  subscription.unsubscribe();
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
  let subscriberA: InnerSubscriber<"a">;
  const promise = race([
    new LazyPromise<"a">((subscriber) => {
      subscriberA = subscriber;
    }),
    new LazyPromise<"b">((subscriber) => {
      setTimeout(() => {
        log("resolve b");
        subscriber.resolve("b");
      }, 1000);
    }),
  ]);
  promise.subscribe({
    resolve: (value) => {
      log("handleValue", value);
      log("resolve a");
      subscriberA.resolve("a");
    },
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
  let subscriberA: InnerSubscriber<"a">;
  const promise = race([
    new LazyPromise<"a">((subscriber) => {
      subscriberA = subscriber;
    }),
    new LazyPromise<never>((subscriber) => {
      setTimeout(() => {
        log("reject b");
        subscriber.reject("b");
      }, 1000);
    }),
  ]);
  promise.subscribe({
    reject: (error) => {
      log("handleError", error);
      log("resolve a");
      subscriberA.resolve("a");
    },
  });
  vi.runAllTimers();
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

test("internally disposed when a source resolves, a source reject is ignored when internally disposed", () => {
  let subscriberA: InnerSubscriber<never>;
  const promise = race([
    new LazyPromise<never>((subscriber) => {
      subscriberA = subscriber;
    }),
    new LazyPromise<"b">((subscriber) => {
      setTimeout(() => {
        log("resolve b");
        subscriber.resolve("b");
      }, 1000);
    }),
  ]);
  promise.subscribe({
    resolve: (value) => {
      log("handleValue", value);
      log("reject a");
      subscriberA.reject("a");
    },
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
        "reject a",
      ],
    ]
  `);
});

test("internally disposed by the teardown function, a source resolve is ignored when internally disposed", () => {
  let subscriberA: InnerSubscriber<"a"> | undefined;
  let subscriberB: InnerSubscriber<"b"> | undefined;
  const promise = race([
    new LazyPromise<"a">((subscriber) => {
      log("produce a");
      subscriberA = subscriber;
      return () => {
        log("dispose a");
        subscriberA = undefined;
        subscriberB?.resolve("b");
      };
    }),
    new LazyPromise<"b">((subscriber) => {
      log("produce b");
      subscriberB = subscriber;
      return () => {
        log("dispose b");
        subscriberB = undefined;
        subscriberA?.resolve("a");
      };
    }),
  ]);
  promise.subscribe(logSubscriber).unsubscribe();
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
