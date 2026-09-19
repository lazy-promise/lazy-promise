import type { Consumer, Sink } from "@lazy-promise/core";
import {
  allKeyed,
  box,
  ErrorBox,
  LazyPromise,
  rejecting,
} from "@lazy-promise/core";
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
  expectTypeOf(allKeyed({})).toEqualTypeOf<LazyPromise<{}>>();

  expectTypeOf(
    allKeyed({
      a: new LazyPromise<"value a" | ErrorBox<"error a">>(() => {}),
      b: (true as boolean) ? "value b" : new ErrorBox("error b"),
    }),
  ).toEqualTypeOf<
    LazyPromise<
      { a: "value a"; b: "value b" } | ErrorBox<"error a"> | ErrorBox<"error b">
    >
  >();

  expectTypeOf(
    allKeyed({
      a: new LazyPromise<"value a" | ErrorBox<"error a">>(() => {}),
      b: new LazyPromise<never>(() => {}),
    }),
  ).toEqualTypeOf<LazyPromise<ErrorBox<"error a">>>();

  expectTypeOf(
    allKeyed({
      a: new LazyPromise<"value a", { a: null }>(() => {}),
      b: new LazyPromise<"value b", { b: null }>(() => {}),
      c: "value c",
    }),
  ).toEqualTypeOf<
    LazyPromise<
      { a: "value a"; b: "value b"; c: "value c" },
      { a: null } & { b: null }
    >
  >();

  const symbolKey = Symbol("key");
  expectTypeOf(
    allKeyed({ [symbolKey]: new LazyPromise<"value">(() => {}) }),
  ).toEqualTypeOf<LazyPromise<{ [symbolKey]: "value" }>>();

  interface Sources {
    a: LazyPromise<number>;
    b: string;
  }
  expectTypeOf(allKeyed({} as Sources)).toEqualTypeOf<
    LazyPromise<{ a: number; b: string }>
  >();

  () => {
    expectTypeOf(
      allKeyed(new LazyPromise<number>(() => {})),
    ).toEqualTypeOf<never>();
  };
});

test("empty object", () => {
  const promise = allKeyed({});
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

test("the object is a LazyPromise", () => {
  expect(() => {
    allKeyed(new LazyPromise(() => {}));
  }).toThrowErrorMatchingInlineSnapshot(
    `[Error: A LazyPromise passed to allKeyed(...) must be wrapped in an object.]`,
  );
});

test("sync resolve", () => {
  const promise = allKeyed({ a: box("a"), b: "b" });
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

test("result has a null prototype and keys in source order", () => {
  const promise = allKeyed({
    a: new LazyPromise<"a">((sink) => {
      setTimeout(() => {
        sink.resolve("a");
      }, 1000);
    }),
    b: "b",
  });
  promise.subscribe({
    resolve: (value) => {
      log(Object.getPrototypeOf(value), Reflect.ownKeys(value));
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
  const sources = { a: box("a"), [enumerableSymbol]: box("b") };
  Object.defineProperty(sources, nonEnumerableSymbol, {
    value: rejecting("oops"),
    enumerable: false,
  });
  const promise = allKeyed(sources);
  promise.subscribe(logConsumer);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleValue",
        {
          "a": "a",
          Symbol(enumerable): "b",
        },
      ],
    ]
  `);
});

test("boxed error emitted by a symbol-keyed source", () => {
  const symbol = Symbol("symbol");
  const promise = allKeyed({
    a: new LazyPromise<"a">(() => () => {
      log("dispose a");
    }),
    [symbol]: new ErrorBox("oops"),
  });
  promise.subscribe<unknown>(logConsumer);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "dispose a",
      ],
      [
        "handleValue",
        ErrorBox {
          "error": "oops",
        },
      ],
    ]
  `);
});

test("async resolve", () => {
  const promise = allKeyed({
    a: new LazyPromise<"a">((sink) => {
      setTimeout(() => {
        sink.resolve("a");
      }, 2000);
    }),
    b: new LazyPromise<"b">((sink) => {
      setTimeout(() => {
        sink.resolve("b");
      }, 1000);
    }),
    c: box("c" as const),
  });
  promise.subscribe(logConsumer);
  vi.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "2000 ms passed",
      [
        "handleValue",
        {
          "a": "a",
          "b": "b",
          "c": "c",
        },
      ],
    ]
  `);
});

test("boxed error passed as one of the sources should be passed on as result", () => {
  const promise = allKeyed({ a: "a", b: new ErrorBox("oops") });
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
  const promise = allKeyed({
    a: new LazyPromise<"a">(() => () => {
      log("dispose a");
    }),
    b: new LazyPromise<"b" | ErrorBox<"oops">>((sink) => {
      setTimeout(() => {
        sink.resolve(new ErrorBox("oops"));
      }, 1000);
    }),
  });
  promise.subscribe<unknown>(logConsumer);
  vi.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "1000 ms passed",
      [
        "dispose a",
      ],
      [
        "handleValue",
        ErrorBox {
          "error": "oops",
        },
      ],
    ]
  `);
});

test("rejection of one of the sources should reject result", () => {
  const promise = allKeyed({
    a: new LazyPromise<"a">(() => () => {
      log("dispose a");
    }),
    b: new LazyPromise<"b">((sink) => {
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

test("internally disposed when a source rejects, internal disposal should prevent further subscriptions to sources", () => {
  const promise = allKeyed({
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
        "dispose a",
      ],
      [
        "handleError",
        "b",
      ],
    ]
  `);
});

test("dispose", () => {
  const promise = allKeyed({
    a: new LazyPromise<"a">(() => {
      log("produce a");
      return () => {
        log("dispose a");
      };
    }),
    b: box("b" as const),
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

test("internally disposed when a source rejects, a source resolve is ignored when internally disposed", () => {
  let sinkA: Sink<"a">;
  const promise = allKeyed({
    a: new LazyPromise<"a">((sink) => {
      log("produce a");
      sinkA = sink;
    }),
    b: new LazyPromise<never>((sink) => {
      setTimeout(() => {
        log("call reject b");
        sink.reject("b");
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
  const promise = allKeyed({
    a: new LazyPromise<never>((sink) => {
      log("produce a");
      sinkA = sink;
    }),
    b: new LazyPromise<never>((sink) => {
      setTimeout(() => {
        log("call reject b");
        sink.reject("b");
      }, 1000);
    }),
  });
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
  const promise = allKeyed({
    a: new LazyPromise<never>((sink) => {
      log("produce a");
      sinkA = sink;
      return () => {
        log("dispose a");
        sinkB?.reject("b");
      };
    }),
    b: new LazyPromise<never>((sink) => {
      log("produce b");
      sinkB = sink;
      return () => {
        log("dispose b");
        sinkA?.reject("a");
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
  allKeyed({
    a: new LazyPromise<void, "dep">((sink, dep) => {
      log("promise a dep", dep);
      sink.resolve();
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
