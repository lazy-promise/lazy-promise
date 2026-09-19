import type { Consumer, Sink } from "@lazy-promise/core";
import { anyKeyed, box, ErrorBox, LazyPromise } from "@lazy-promise/core";
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
  expectTypeOf(anyKeyed({})).toEqualTypeOf<LazyPromise<ErrorBox<{}>>>();

  expectTypeOf(
    anyKeyed({
      a: new LazyPromise<"value a" | ErrorBox<"error a">>(() => {}),
      b: (true as boolean) ? "value b" : new ErrorBox("error b"),
    }),
  ).toEqualTypeOf<
    LazyPromise<
      "value a" | "value b" | ErrorBox<{ a: "error a"; b: "error b" }>
    >
  >();

  expectTypeOf(
    anyKeyed({
      a: new LazyPromise<"value a" | ErrorBox<"error a">>(() => {}),
      b: new LazyPromise<never>(() => {}),
    }),
  ).toEqualTypeOf<LazyPromise<"value a">>();

  expectTypeOf(
    anyKeyed({
      a: new LazyPromise<"value a", { a: null }>(() => {}),
      b: new LazyPromise<"value b", { b: null }>(() => {}),
      c: "value c",
    }),
  ).toEqualTypeOf<
    LazyPromise<"value a" | "value b" | "value c", { a: null } & { b: null }>
  >();

  const symbolKey = Symbol("key");
  expectTypeOf(
    anyKeyed({ [symbolKey]: new LazyPromise<ErrorBox<"error">>(() => {}) }),
  ).toEqualTypeOf<LazyPromise<ErrorBox<{ [symbolKey]: "error" }>>>();

  interface Sources {
    a: LazyPromise<number | ErrorBox<"error a">>;
    b: ErrorBox<"error b">;
  }
  expectTypeOf(anyKeyed({} as Sources)).toEqualTypeOf<
    LazyPromise<number | ErrorBox<{ a: "error a"; b: "error b" }>>
  >();

  () => {
    expectTypeOf(
      anyKeyed(new LazyPromise<number>(() => {})),
    ).toEqualTypeOf<never>();
  };
});

test("empty object", () => {
  const promise = anyKeyed({});
  promise.subscribe<unknown>(logConsumer);
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

test("the object is a LazyPromise", () => {
  expect(() => {
    anyKeyed(new LazyPromise(() => {}));
  }).toThrowErrorMatchingInlineSnapshot(
    `[Error: A LazyPromise passed to anyKeyed(...) must be wrapped in an object.]`,
  );
});

test("sync resolve", () => {
  const promise = anyKeyed({
    a: box(new ErrorBox("a" as const)),
    b: new ErrorBox("b" as const),
  });
  promise.subscribe<unknown>(logConsumer);
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

test("errors object has a null prototype and keys in source order", () => {
  const promise = anyKeyed({
    a: new LazyPromise<ErrorBox<"a">>((sink) => {
      setTimeout(() => {
        sink.resolve(new ErrorBox("a"));
      }, 1000);
    }),
    b: new ErrorBox("b"),
  });
  promise.subscribe<unknown>({
    resolve: (value) => {
      const errors = (value as ErrorBox<object>).error;
      log(Object.getPrototypeOf(errors), Reflect.ownKeys(errors));
    },
  });
  vi.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "1000 ms passed",
      [
        null,
        [
          "a",
          "b",
        ],
      ],
    ]
  `);
});

test("symbol keys", () => {
  const enumerableSymbol = Symbol("enumerable");
  const nonEnumerableSymbol = Symbol("nonEnumerable");
  const sources = {
    a: box(new ErrorBox("a")),
    [enumerableSymbol]: box(new ErrorBox("b")),
  };
  Object.defineProperty(sources, nonEnumerableSymbol, {
    value: box("c"),
    enumerable: false,
  });
  const promise = anyKeyed(sources);
  promise.subscribe<unknown>(logConsumer);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleValue",
        ErrorBox {
          "error": {
            "a": "a",
            Symbol(enumerable): "b",
          },
        },
      ],
    ]
  `);
});

test("non-error value emitted by a symbol-keyed source", () => {
  const symbol = Symbol("symbol");
  const promise = anyKeyed({
    a: new LazyPromise<ErrorBox<"a">>(() => () => {
      log("dispose a");
    }),
    [symbol]: "b",
  });
  promise.subscribe(logConsumer);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "dispose a",
      ],
      [
        "handleValue",
        "b",
      ],
    ]
  `);
});

test("non-error value passed as one of the sources should resolve result", () => {
  const promise = anyKeyed({ a: new ErrorBox("oops"), b: "b" });
  promise.subscribe(logConsumer);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleValue",
        "b",
      ],
    ]
  `);
});

test("async resolve with typed errors", () => {
  const promise = anyKeyed({
    a: new LazyPromise<ErrorBox<"a">>((sink) => {
      setTimeout(() => {
        sink.resolve(new ErrorBox("a"));
      }, 2000);
    }),
    b: new LazyPromise<ErrorBox<"b">>((sink) => {
      setTimeout(() => {
        sink.resolve(new ErrorBox("b"));
      }, 1000);
    }),
    c: box(new ErrorBox("c")),
  });
  promise.subscribe<unknown>(logConsumer);
  vi.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "2000 ms passed",
      [
        "handleValue",
        ErrorBox {
          "error": {
            "a": "a",
            "b": "b",
            "c": "c",
          },
        },
      ],
    ]
  `);
});

test("resolving of one of the sources should resolve result", () => {
  const promise = anyKeyed({
    a: new LazyPromise<"a">(() => () => {
      log("dispose a");
    }),
    b: new LazyPromise<"b">((sink) => {
      setTimeout(() => {
        sink.resolve("b");
      }, 1000);
    }),
  });
  promise.subscribe(logConsumer);
  vi.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "1000 ms passed",
      [
        "dispose a",
      ],
      [
        "handleValue",
        "b",
      ],
    ]
  `);
});

test("rejection of one of the sources should reject result", () => {
  const promise = anyKeyed({
    a: new LazyPromise<"a">(() => () => {
      log("dispose a");
    }),
    b: new LazyPromise((sink) => {
      setTimeout(() => {
        sink.reject("oops");
      }, 1000);
    }),
  });
  promise.subscribe(logConsumer);
  vi.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "1000 ms passed",
      [
        "dispose a",
      ],
      [
        "handleError",
        "oops",
      ],
    ]
  `);
});

test("internally disposed when a source resolves, internal disposal should prevent further subscriptions to sources", () => {
  const promise = anyKeyed({
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
        "dispose a",
      ],
      [
        "handleValue",
        "b",
      ],
    ]
  `);
});

test("dispose", () => {
  const promise = anyKeyed({
    a: new LazyPromise<"a">(() => {
      log("produce a");
      return () => {
        log("dispose a");
      };
    }),
    b: box(new ErrorBox("b")),
  });
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
  const promise = anyKeyed({
    a: new LazyPromise<"a">((sink) => {
      log("produce a");
      sinkA = sink;
    }),
    b: new LazyPromise<"b">((sink) => {
      setTimeout(() => {
        log("call resolve b");
        sink.resolve("b");
      }, 1000);
    }),
  });
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
  const promise = anyKeyed({
    a: new LazyPromise<"a">((sink) => {
      log("produce a");
      sinkA = sink;
    }),
    b: new LazyPromise<"b">((sink) => {
      setTimeout(() => {
        log("call resolve b");
        sink.resolve("b");
      }, 1000);
    }),
  });
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
  const promise = anyKeyed({
    a: new LazyPromise<"a">((sink) => {
      sinkA = sink;
    }),
    b: new LazyPromise<never>((sink) => {
      setTimeout(() => {
        log("call reject b");
        sink.reject("oops");
      }, 1000);
    }),
  });
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
  const promise = anyKeyed({
    a: new LazyPromise<"a">((sink) => {
      log("produce a");
      sinkA = sink;
      return () => {
        log("dispose a");
        sinkB?.resolve("b");
      };
    }),
    b: new LazyPromise<"b">((sink) => {
      log("produce b");
      sinkB = sink;
      return () => {
        log("dispose b");
        sinkA?.resolve("a");
      };
    }),
  });
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
        "dispose b",
      ],
      [
        "dispose a",
      ],
    ]
  `);
});

test("dependency injection", () => {
  anyKeyed({
    a: new LazyPromise<ErrorBox<"error a">, "dep">((sink, dep) => {
      log("promise a dep", dep);
      sink.resolve(new ErrorBox("error a"));
    }),
    b: new LazyPromise<void, "dep">((sink, dep) => {
      log("promise b dep", dep);
      sink.resolve();
    }),
  }).subscribe(undefined, "dep");

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
