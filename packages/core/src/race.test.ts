import type { Consumer, Sink } from "@lazy-promise/core";
import { box, LazyPromise, never, race, rejecting } from "@lazy-promise/core";
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

const logConsumer: Consumer<any> = {
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

test("types", () => {
  expectTypeOf(
    race([
      new LazyPromise<"value a", { a: null }>(() => {}),
      new LazyPromise<"value b", { b: null }>(() => {}),
    ]),
  ).toEqualTypeOf<
    LazyPromise<"value a" | "value b", { a: null } & { b: null }>
  >();

  expectTypeOf(
    race([new LazyPromise<"value a", { a: null }>(() => {}), 42]),
  ).toEqualTypeOf<LazyPromise<"value a" | number, { a: null }>>();

  () => {
    expectTypeOf(
      race(new LazyPromise<number>(() => {})),
    ).toEqualTypeOf<never>();
  };
});

test("empty iterable", () => {
  const promise = race([]);
  promise.subscribe(logConsumer);
  expect(readLog()).toMatchInlineSnapshot(`[]`);
});

test("the iterable is a LazyPromise", () => {
  expect(() => {
    race(new LazyPromise(() => {}));
  }).toThrowErrorMatchingInlineSnapshot(
    `[Error: A LazyPromise passed to race(...) must be wrapped in an Iterable such as an array.]`,
  );
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
  promise.subscribe(logConsumer);
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
  promise.subscribe(logConsumer);
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
  promise.subscribe(logConsumer);
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
    new LazyPromise<"a">((sink) => {
      const timeoutId = setTimeout(() => {
        sink.resolve("a");
      }, 1000);
      return () => {
        log("dispose a");
        clearTimeout(timeoutId);
      };
    }),
    new LazyPromise<"b">((sink) => {
      const timeoutId = setTimeout(() => {
        sink.resolve("b");
      }, 2000);
      return () => {
        log("dispose b");
        clearTimeout(timeoutId);
      };
    }),
  ]);
  promise.subscribe(logConsumer);
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
  promise.subscribe(logConsumer);
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
    new LazyPromise<never>((sink) => {
      const timeoutId = setTimeout(() => {
        sink.reject("a");
      }, 1000);
      return () => {
        log("dispose a");
        clearTimeout(timeoutId);
      };
    }),
    new LazyPromise<"b">((sink) => {
      const timeoutId = setTimeout(() => {
        sink.resolve("b");
      }, 2000);
      return () => {
        log("dispose b");
        clearTimeout(timeoutId);
      };
    }),
  ]);
  promise.subscribe(logConsumer);
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
  subscription.dispose();
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
  let sinkA: Sink<"a">;
  const promise = race([
    new LazyPromise<"a">((sink) => {
      sinkA = sink;
    }),
    new LazyPromise<"b">((sink) => {
      setTimeout(() => {
        log("resolve b");
        sink.resolve("b");
      }, 1000);
    }),
  ]);
  promise.subscribe({
    resolve: (value) => {
      log("handleValue", value);
      log("resolve a");
      sinkA.resolve("a");
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
  let sinkA: Sink<"a">;
  const promise = race([
    new LazyPromise<"a">((sink) => {
      sinkA = sink;
    }),
    new LazyPromise<never>((sink) => {
      setTimeout(() => {
        log("reject b");
        sink.reject("b");
      }, 1000);
    }),
  ]);
  promise.subscribe({
    reject: (error) => {
      log("handleError", error);
      log("resolve a");
      sinkA.resolve("a");
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
  let sinkA: Sink<never>;
  const promise = race([
    new LazyPromise<never>((sink) => {
      sinkA = sink;
    }),
    new LazyPromise<"b">((sink) => {
      setTimeout(() => {
        log("resolve b");
        sink.resolve("b");
      }, 1000);
    }),
  ]);
  promise.subscribe({
    resolve: (value) => {
      log("handleValue", value);
      log("reject a");
      sinkA.reject("a");
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
  let sinkA: Sink<"a"> | undefined;
  let sinkB: Sink<"b"> | undefined;
  const promise = race([
    new LazyPromise<"a">((sink) => {
      log("produce a");
      sinkA = sink;
      return () => {
        log("dispose a");
        sinkA = undefined;
        sinkB?.resolve("b");
      };
    }),
    new LazyPromise<"b">((sink) => {
      log("produce b");
      sinkB = sink;
      return () => {
        log("dispose b");
        sinkB = undefined;
        sinkA?.resolve("a");
      };
    }),
  ]);
  promise.subscribe(logConsumer).dispose();
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

test("dependency injection", () => {
  race([
    new LazyPromise<never, "dep">((sink, dep) => {
      log("promise a dep", dep);
    }),
    new LazyPromise<void, "dep">((sink, dep) => {
      log("promise b dep", dep);
      sink.resolve();
    }),
  ]).subscribe(undefined, "dep");

  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "promise a dep",
        "dep",
      ],
      [
        "promise b dep",
        "dep",
      ],
    ]
  `);
});
