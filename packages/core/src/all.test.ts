import type { Consumer, Sink } from "@lazy-promise/core";
import { all, box, ErrorBox, LazyPromise, rejecting } from "@lazy-promise/core";
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
  expectTypeOf(all([])).toEqualTypeOf<LazyPromise<[]>>();

  expectTypeOf(
    all([
      new LazyPromise<"value a" | ErrorBox<"error a">>(() => {}),
      (true as boolean) ? "value b" : new ErrorBox("error b"),
    ]),
  ).toEqualTypeOf<
    LazyPromise<
      ["value a", "value b"] | ErrorBox<"error a"> | ErrorBox<"error b">
    >
  >();

  expectTypeOf(
    all([
      new LazyPromise<"value a" | ErrorBox<"error a">>(() => {}),
      new LazyPromise<never>(() => {}),
    ]),
  ).toEqualTypeOf<LazyPromise<ErrorBox<"error a">>>();

  expectTypeOf(all({})).toEqualTypeOf<LazyPromise<{}>>();

  expectTypeOf(
    all({
      a: new LazyPromise<"value a" | ErrorBox<"error a">>(() => {}),
      b: (true as boolean) ? "value b" : new ErrorBox("error b"),
    }),
  ).toEqualTypeOf<
    LazyPromise<
      | ErrorBox<"error a">
      | ErrorBox<"error b">
      | {
          readonly a: "value a";
          readonly b: "value b";
        }
    >
  >();

  expectTypeOf(
    all({
      a: new LazyPromise<"value a" | ErrorBox<"error a">>(() => {}),
      b: new LazyPromise<never>(() => {}),
    }),
  ).toEqualTypeOf<LazyPromise<ErrorBox<"error a">>>();

  expectTypeOf(all(new Set([]))).toEqualTypeOf<LazyPromise<never[]>>();

  expectTypeOf(
    all(
      new Set([
        new LazyPromise<"value a" | ErrorBox<"error a">>(() => {}),
        "value b" as const,
        new ErrorBox("error b"),
      ]),
    ),
  ).toEqualTypeOf<
    LazyPromise<
      ErrorBox<"error a"> | ErrorBox<"error b"> | ("value a" | "value b")[]
    >
  >();

  expectTypeOf(
    all([
      new LazyPromise<"value a", { a: null }>(() => {}),
      new LazyPromise<"value b", { b: null }>(() => {}),
      "value c",
    ]),
  ).toEqualTypeOf<
    LazyPromise<["value a", "value b", "value c"], { a: null } & { b: null }>
  >();

  expectTypeOf(
    all({
      a: new LazyPromise<"value a", { a: null }>(() => {}),
      b: new LazyPromise<"value b", { b: null }>(() => {}),
      c: "value c",
    }),
  ).toEqualTypeOf<
    LazyPromise<
      {
        readonly a: "value a";
        readonly b: "value b";
        readonly c: "value c";
      },
      { a: null } & { b: null }
    >
  >();

  expectTypeOf(
    all(
      new Set([
        new LazyPromise<"value a", { a: null }>(() => {}),
        new LazyPromise<"value b", { b: null }>(() => {}),
        "value c" as const,
      ]),
    ),
  ).toEqualTypeOf<
    LazyPromise<
      ("value a" | "value b" | "value c")[],
      { a: null } & { b: null }
    >
  >();
});

test("empty iterable", () => {
  const promise = all([]);
  promise.subscribe(logConsumer);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleValue",
        [],
      ],
    ]
  `);
});

test("empty object", () => {
  const promise = all({});
  promise.subscribe(logConsumer);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleValue",
        {},
      ],
    ]
  `);
});

test("sync resolve (iterable)", () => {
  const promise = all([box("a"), "b"]);
  promise.subscribe(logConsumer);
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

test("sync resolve (object)", () => {
  const promise = all({ a: box("a"), b: "b" });
  promise.subscribe(logConsumer);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleValue",
        {
          "a": "a",
          "b": "b",
        },
      ],
    ]
  `);
});

test("non-array iterable", () => {
  const promise = all(new Set([box("a")]));
  promise.subscribe(logConsumer);
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
    new LazyPromise<"a">((sink) => {
      setTimeout(() => {
        sink.resolve("a");
      }, 2000);
    }),
    new LazyPromise<"b">((sink) => {
      setTimeout(() => {
        sink.resolve("b");
      }, 1000);
    }),
    box("c" as const),
  ]);
  promise.subscribe(logConsumer);
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

test("boxed error passed as one of the sources should be passed on as result", () => {
  const promise = all(["a", new ErrorBox("oops")]);
  promise.subscribe<unknown>(logConsumer);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleValue",
        ErrorBox {
          "error": "oops",
        },
      ],
    ]
  `);
});

test("boxed error emitted by one of the sources should be passed on as result", () => {
  const promise = all([
    new LazyPromise<"a">(() => () => {
      log("dispose a");
    }),
    new LazyPromise<"b" | ErrorBox<"oops">>((sink) => {
      setTimeout(() => {
        sink.resolve(new ErrorBox("oops"));
      }, 1000);
    }),
  ]);
  promise.subscribe<unknown>(logConsumer);
  vi.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "1000 ms passed",
      [
        "handleValue",
        ErrorBox {
          "error": "oops",
        },
      ],
      [
        "dispose a",
      ],
    ]
  `);
});

test("rejection of one of the sources should reject result", () => {
  const promise = all([
    new LazyPromise<"a">(() => () => {
      log("dispose a");
    }),
    new LazyPromise<"b">((sink) => {
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

test("internally disposed when a source in an iterable rejects, internal disposal should prevent further subscriptions to sources", () => {
  const promise = all([
    new LazyPromise<string>(() => {
      log("produce a");
      return () => {
        log("dispose a");
      };
    }),
    rejecting("b"),
    new LazyPromise<string>(() => {
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
        "handleError",
        "b",
      ],
      [
        "dispose a",
      ],
    ]
  `);
});

test("internally disposed when a source in an object rejects, internal disposal should prevent further subscriptions to sources", () => {
  const promise = all({
    a: new LazyPromise<string>(() => {
      log("produce a");
      return () => {
        log("dispose a");
      };
    }),
    b: rejecting("b"),
    c: new LazyPromise<string>(() => {
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
        "handleError",
        "b",
      ],
      [
        "dispose a",
      ],
    ]
  `);
});

test("dispose", () => {
  const promise = all([
    new LazyPromise<"a">(() => {
      log("produce a");
      return () => {
        log("dispose a");
      };
    }),
    box("b" as const),
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

test("internally disposed when a source rejects, a source resolve is ignored when internally disposed", () => {
  let sinkA: Sink<"a">;
  const promise = all([
    new LazyPromise<"a">((sink) => {
      log("produce a");
      sinkA = sink;
    }),
    new LazyPromise<never>((sink) => {
      setTimeout(() => {
        log("call reject b");
        sink.reject("b");
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
  let sinkA: Sink<never>;
  const promise = all([
    new LazyPromise<never>((sink) => {
      log("produce a");
      sinkA = sink;
    }),
    new LazyPromise<never>((sink) => {
      setTimeout(() => {
        log("call reject b");
        sink.reject("b");
      }, 1000);
    }),
  ]);
  promise.subscribe({
    reject: () => {
      log("call reject a");
      sinkA.reject("a");
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
        "call reject b",
      ],
      [
        "call reject a",
      ],
    ]
  `);
});

test("internally disposed when unsubscribed, a source reject is ignored when internally disposed", () => {
  let sinkA: Sink<never> | undefined;
  let sinkB: Sink<never> | undefined;
  const promise = all([
    new LazyPromise<never>((sink) => {
      log("produce a");
      sinkA = sink;
      return () => {
        log("dispose a");
        sinkB?.reject("b");
      };
    }),
    new LazyPromise<never>((sink) => {
      log("produce b");
      sinkB = sink;
      return () => {
        log("dispose b");
        sinkA?.reject("a");
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

test("dependency injection", () => {
  all([
    new LazyPromise<void, "dep">((sink, dep) => {
      log("promise a dep", dep);
      sink.resolve();
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
