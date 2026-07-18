import type { Consumer, Sink } from "@lazy-promise/core";
import { any, box, ErrorBox, LazyPromise } from "@lazy-promise/core";
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
  expectTypeOf(any([])).toEqualTypeOf<LazyPromise<ErrorBox<[]>>>();

  expectTypeOf(
    any([
      new LazyPromise<"value a" | ErrorBox<"error a">>(() => {}),
      (true as boolean) ? "value b" : new ErrorBox("error b"),
    ]),
  ).toEqualTypeOf<
    LazyPromise<"value a" | "value b" | ErrorBox<["error a", "error b"]>>
  >();

  expectTypeOf(
    any([
      new LazyPromise<"value a" | ErrorBox<"error a">>(() => {}),
      new LazyPromise<never>(() => {}),
    ]),
  ).toEqualTypeOf<LazyPromise<"value a">>();

  expectTypeOf(any({})).toEqualTypeOf<LazyPromise<ErrorBox<{}>>>();

  expectTypeOf(
    any({
      a: new LazyPromise<"value a" | ErrorBox<"error a">>(() => {}),
      b: (true as boolean) ? "value b" : new ErrorBox("error b"),
    }),
  ).toEqualTypeOf<
    LazyPromise<
      | "value a"
      | "value b"
      | ErrorBox<{
          readonly a: "error a";
          readonly b: "error b";
        }>
    >
  >();

  expectTypeOf(
    any({
      a: new LazyPromise<"value a" | ErrorBox<"error a">>(() => {}),
      b: new LazyPromise<never>(() => {}),
    }),
  ).toEqualTypeOf<LazyPromise<"value a">>();

  expectTypeOf(any(new Set([]))).toEqualTypeOf<
    LazyPromise<ErrorBox<never[]>>
  >();

  expectTypeOf(
    any(
      new Set([
        new LazyPromise<"value a" | ErrorBox<"error a">>(() => {}),
        "value b" as const,
        new ErrorBox("error b"),
      ]),
    ),
  ).toEqualTypeOf<
    LazyPromise<"value a" | "value b" | ErrorBox<("error a" | "error b")[]>>
  >();
});

test("empty iterable", () => {
  const promise = any([]);
  promise.subscribe(logConsumer);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleValue",
        ErrorBox {
          "error": [],
        },
      ],
    ]
  `);
});

test("empty object", () => {
  const promise = any({});
  promise.subscribe(logConsumer);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleValue",
        ErrorBox {
          "error": {},
        },
      ],
    ]
  `);
});

test("sync resolve (iterable)", () => {
  const promise = any([
    box(new ErrorBox("a" as const)),
    new ErrorBox("b" as const),
  ]);
  promise.subscribe(logConsumer);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleValue",
        ErrorBox {
          "error": [
            "a",
            "b",
          ],
        },
      ],
    ]
  `);
});

test("sync resolve (object)", () => {
  const promise = any({
    a: box(new ErrorBox("a" as const)),
    b: new ErrorBox("b" as const),
  });
  promise.subscribe(logConsumer);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleValue",
        ErrorBox {
          "error": {
            "a": "a",
            "b": "b",
          },
        },
      ],
    ]
  `);
});

test("non-array iterable", () => {
  const promise = any(new Set([box(new ErrorBox("a"))]));
  promise.subscribe(logConsumer);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleValue",
        ErrorBox {
          "error": [
            "a",
          ],
        },
      ],
    ]
  `);
});

test("async resolve with typed errors", () => {
  const promise = any([
    new LazyPromise<ErrorBox<"a">>((sink) => {
      setTimeout(() => {
        sink.resolve(new ErrorBox("a"));
      }, 2000);
    }),
    new LazyPromise<ErrorBox<"b">>((sink) => {
      setTimeout(() => {
        sink.resolve(new ErrorBox("b"));
      }, 1000);
    }),
    box(new ErrorBox("c")),
  ]);
  promise.subscribe(logConsumer);
  vi.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "2000 ms passed",
      [
        "handleValue",
        ErrorBox {
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

test("non-error value passed as one of the sources should resolve result", () => {
  const promise = any([new ErrorBox("oops"), "a"]);
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

test("resolving of one of the sources should resolve result", () => {
  const promise = any([
    new LazyPromise<"a">(() => () => {
      log("dispose a");
    }),
    new LazyPromise<"b">((sink) => {
      setTimeout(() => {
        sink.resolve("b");
      }, 1000);
    }),
  ]);
  promise.subscribe(logConsumer);
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
    new LazyPromise((sink) => {
      setTimeout(() => {
        sink.reject("oops");
      }, 1000);
    }),
  ]);
  promise.subscribe(logConsumer);
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

test("internally disposed when a source in an iterable resolves, internal disposal should prevent further subscriptions to sources", () => {
  const promise = any([
    new LazyPromise<ErrorBox<string>>(() => {
      log("produce a");
      return () => {
        log("dispose a");
      };
    }),
    box("b"),
    new LazyPromise<ErrorBox<string>>(() => {
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

test("internally disposed when a source in an object resolves, internal disposal should prevent further subscriptions to sources", () => {
  const promise = any({
    a: new LazyPromise<ErrorBox<string>>(() => {
      log("produce a");
      return () => {
        log("dispose a");
      };
    }),
    b: box("b"),
    c: new LazyPromise<ErrorBox<string>>(() => {
      log("produce c");
    }),
  });
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

test("dispose", () => {
  const promise = any([
    new LazyPromise<"a">(() => {
      log("produce a");
      return () => {
        log("dispose a");
      };
    }),
    box(new ErrorBox("b")),
  ]);
  const subscription = promise.subscribe();
  vi.advanceTimersByTime(1000);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "produce a",
      ],
    ]
  `);
  subscription.dispose();
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
  let sinkA: Sink<"a">;
  const promise = any([
    new LazyPromise<"a">((sink) => {
      log("produce a");
      sinkA = sink;
    }),
    new LazyPromise<"b">((sink) => {
      setTimeout(() => {
        log("call resolve b");
        sink.resolve("b");
      }, 1000);
    }),
  ]);
  promise.subscribe({
    resolve: () => {
      log("call resolve a");
      sinkA.resolve("a");
    },
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
  let sinkA: Sink<"a">;
  const promise = any([
    new LazyPromise<"a">((sink) => {
      log("produce a");
      sinkA = sink;
    }),
    new LazyPromise<"b">((sink) => {
      setTimeout(() => {
        log("call resolve b");
        sink.resolve("b");
      }, 1000);
    }),
  ]);
  promise.subscribe({
    resolve: () => {
      log("call reject a");
      sinkA.reject("oops");
    },
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
  let sinkA: Sink<"a">;
  const promise = any([
    new LazyPromise<"a">((sink) => {
      sinkA = sink;
    }),
    new LazyPromise<never>((sink) => {
      setTimeout(() => {
        log("call reject b");
        sink.reject("oops");
      }, 1000);
    }),
  ]);
  promise.subscribe({
    reject: () => {
      log("call resolve a");
      sinkA.resolve("a");
    },
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
  let sinkA: Sink<"a"> | undefined;
  let sinkB: Sink<"b"> | undefined;
  const promise = any([
    new LazyPromise<"a">((sink) => {
      log("produce a");
      sinkA = sink;
      return () => {
        log("dispose a");
        sinkB?.resolve("b");
      };
    }),
    new LazyPromise<"b">((sink) => {
      log("produce b");
      sinkB = sink;
      return () => {
        log("dispose b");
        sinkA?.resolve("a");
      };
    }),
  ]);
  promise.subscribe().dispose();
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
