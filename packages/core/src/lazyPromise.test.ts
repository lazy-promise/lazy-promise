import type {
  Consumer,
  Disposable,
  ErrorBox,
  Producer,
  Sink,
} from "@lazy-promise/core";
import { box, LazyPromise, never, rejecting } from "@lazy-promise/core";
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
  const promise1 = new LazyPromise<
    "value a" | ErrorBox<"error a"> | ErrorBox<"error b">
  >(() => {});

  promise1.subscribe<"error a" | "error b">();

  promise1.subscribe<"error a" | "error b">(undefined);

  promise1.subscribe<"error a" | "error b">({});

  promise1.subscribe<"error a" | "error b">({
    resolve: (value) =>
      expectTypeOf(value).toEqualTypeOf<
        "value a" | ErrorBox<"error a"> | ErrorBox<"error b">
      >(),
    reject: () => {},
  });

  promise1.subscribe<"error a" | "error b" | "error c">();

  promise1.subscribe<unknown>();

  promise1.subscribe<any>();

  /** @ts-expect-error */
  promise1.subscribe();

  /** @ts-expect-error */
  promise1.subscribe<"error a">();

  const promise2 = new LazyPromise<"value a">(() => {});

  promise2.subscribe();

  promise2.subscribe<"error a">();

  const promise3 = never as
    | LazyPromise<1 | ErrorBox<"error a">>
    | LazyPromise<2 | ErrorBox<"error b">>;

  promise3.subscribe<"error a" | "error b">({
    resolve: (value) =>
      expectTypeOf(value).toEqualTypeOf<
        1 | 2 | ErrorBox<"error a"> | ErrorBox<"error b">
      >(),
  });

  /** @ts-expect-error */
  promise3.subscribe();

  /** @ts-expect-error */
  promise3.subscribe<"error a">();

  /** @ts-expect-error */
  promise3.subscribe<"error b">();

  expectTypeOf(box("a")).toEqualTypeOf<LazyPromise<"a">>();

  expectTypeOf(box()).toEqualTypeOf<LazyPromise<void>>();

  expectTypeOf(box(new LazyPromise<"value">(() => {}))).toEqualTypeOf<
    LazyPromise<"value">
  >();

  expectTypeOf(
    box(
      (true as boolean)
        ? "a"
        : new LazyPromise<"value" | ErrorBox<"error">>(() => {}),
    ),
  ).toEqualTypeOf<LazyPromise<"a" | "value" | ErrorBox<"error">>>();

  expectTypeOf(rejecting("a")).toEqualTypeOf<LazyPromise<never>>();

  expectTypeOf(rejecting()).toEqualTypeOf<LazyPromise<never>>();

  // Check that boxed errors are nominally typed.
  expectTypeOf({ error: "a" }).not.toExtend<ErrorBox<string>>();

  expectTypeOf<LazyPromise<"a">>().toExtend<LazyPromise<string>>();
  expectTypeOf<LazyPromise<string>>().not.toExtend<LazyPromise<"a">>();

  expectTypeOf<Sink<string>>().toExtend<Sink<"a">>();
  expectTypeOf<Sink<"a">>().not.toExtend<Sink<string>>();

  const operator = <Value>(lazyPromise: LazyPromise<Value>) => lazyPromise;
  expectTypeOf(
    (never as LazyPromise<1> | LazyPromise<2>).pipe(operator),
  ).toEqualTypeOf<LazyPromise<1 | 2>>();
});

test("value of this in the basic scenario", () => {
  const promise = new LazyPromise<never>(function () {
    /** @ts-expect-error */
    log("in produce", this);
    return function () {
      /** @ts-expect-error */
      log("in dispose", this);
    };
  });
  promise.subscribe().dispose();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "in produce",
        undefined,
      ],
      [
        "in dispose",
        undefined,
      ],
    ]
  `);
});

test("async resolve", () => {
  const promise = new LazyPromise<string>((sink) => {
    setTimeout(() => {
      sink.resolve("value");
    }, 1000);
    return () => {
      log("dispose");
    };
  });
  promise.subscribe(logConsumer);
  vi.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "1000 ms passed",
      [
        "handleValue",
        "value",
      ],
    ]
  `);
});

test("async resolve (class-based)", () => {
  const producer: Producer<string> = {
    produce(sink) {
      expect(this).toBe(producer);
      setTimeout(() => {
        sink.resolve("value");
      }, 1000);
      return () => {
        log("dispose");
      };
    },
  };
  const promise = new LazyPromise<string>(producer);
  promise.subscribe(logConsumer);
  vi.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "1000 ms passed",
      [
        "handleValue",
        "value",
      ],
    ]
  `);
});

test("async resolve (flattening)", () => {
  const promise = new LazyPromise<string>((sink) => {
    setTimeout(() => {
      sink.resolve(box("value"));
    }, 1000);
    return () => {
      log("dispose");
    };
  });
  promise.subscribe(logConsumer);
  vi.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "1000 ms passed",
      [
        "handleValue",
        "value",
      ],
    ]
  `);
});

test("sync resolve", () => {
  new LazyPromise<string>((sink) => {
    log("produce");
    sink.resolve("value");
    return () => {
      log("dispose");
    };
  }).subscribe(logConsumer);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "produce",
      ],
      [
        "handleValue",
        "value",
      ],
    ]
  `);
});

test("sync resolve (flattening)", () => {
  new LazyPromise<string>((sink) => {
    log("produce");
    sink.resolve(box("value"));
    return () => {
      log("dispose");
    };
  }).subscribe(logConsumer);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "produce",
      ],
      [
        "handleValue",
        "value",
      ],
    ]
  `);
});

test("async reject", () => {
  const promise = new LazyPromise<unknown>((sink) => {
    setTimeout(() => {
      sink.reject("oops");
    }, 1000);
    return () => {
      log("dispose");
    };
  });
  promise.subscribe(logConsumer);
  vi.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "1000 ms passed",
      [
        "handleError",
        "oops",
      ],
    ]
  `);
});

test("sync reject", () => {
  new LazyPromise<unknown>((sink) => {
    log("produce");
    sink.reject("oops");
    return () => {
      log("dispose");
    };
  }).subscribe(logConsumer);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "produce",
      ],
      [
        "handleError",
        "oops",
      ],
    ]
  `);
});

test("no teardown function", () => {
  new LazyPromise<never>(() => {
    log("produce");
  })
    .subscribe()
    .dispose();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "produce",
      ],
    ]
  `);
});

test("cancellation", () => {
  const promise = new LazyPromise<string>(() => {
    log("produce");
    return () => {
      log("dispose");
    };
  });
  const subscription = promise.subscribe();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "produce",
      ],
    ]
  `);
  subscription.dispose();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "dispose",
      ],
    ]
  `);
  subscription.dispose();
  expect(readLog()).toMatchInlineSnapshot(`[]`);
});

test("cancellation (class-based)", () => {
  const job: Disposable = {
    dispose() {
      log("dispose");
      expect(this).toBe(job);
    },
  };
  const promise = new LazyPromise<string>(() => {
    log("produce");
    return job;
  });
  const subscription = promise.subscribe();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "produce",
      ],
    ]
  `);
  subscription.dispose();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "dispose",
      ],
    ]
  `);
  subscription.dispose();
  expect(readLog()).toMatchInlineSnapshot(`[]`);
});

test("unsubscribe from produce", () => {
  const promise = new LazyPromise<string>((sink) => {
    setTimeout(() => {
      sink.resolve(
        new LazyPromise(() => {
          // eslint-disable-next-line no-use-before-define
          subscription.dispose();
          sink.resolve("value");
          return function () {
            /** @ts-expect-error */
            log("dispose inner", this);
          };
        }),
      );
    }, 1000);
    return () => {
      log("dispose outer");
    };
  });
  const subscription = promise.subscribe(logConsumer);
  vi.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "1000 ms passed",
      [
        "dispose inner",
        undefined,
      ],
    ]
  `);
});

test("unsubscribe from produce (class-based)", () => {
  const job: Disposable = {
    dispose() {
      log("dispose inner");
      expect(this).toBe(job);
    },
  };
  const promise = new LazyPromise<string>((sink) => {
    setTimeout(() => {
      sink.resolve(
        new LazyPromise(() => {
          // eslint-disable-next-line no-use-before-define
          subscription.dispose();
          sink.resolve("value");
          return job;
        }),
      );
    }, 1000);
    return () => {
      log("dispose outer");
    };
  });
  const subscription = promise.subscribe(logConsumer);
  vi.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "1000 ms passed",
      [
        "dispose inner",
      ],
    ]
  `);
});

test("unsubscribe from produce (error in unsubscribe)", () => {
  const promise = new LazyPromise<string>((sink) => {
    setTimeout(() => {
      sink.resolve(
        new LazyPromise(() => {
          // eslint-disable-next-line no-use-before-define
          subscription.dispose();
          sink.resolve("value");
          return () => {
            log("dispose inner");
            throw "oops";
          };
        }),
      );
    }, 1000);
    return () => {
      log("dispose outer");
    };
  });
  const subscription = promise.subscribe(logConsumer);
  vi.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "1000 ms passed",
      [
        "dispose inner",
      ],
    ]
  `);
  expect(processMockMicrotaskQueue).toThrow("oops");
});

test("unsubscribe from produce (no teardown function)", () => {
  const promise = new LazyPromise<string>((sink) => {
    setTimeout(() => {
      sink.resolve(
        new LazyPromise(() => {
          // eslint-disable-next-line no-use-before-define
          subscription.dispose();
          sink.resolve("value");
        }),
      );
    }, 1000);
    return () => {
      log("dispose outer");
    };
  });
  const subscription = promise.subscribe(logConsumer);
  vi.runAllTimers();
});

test("teardown function is not called if the lazy promise resolves", () => {
  const promise = new LazyPromise<number>((sink) => {
    setTimeout(() => {
      sink.resolve(1);
    }, 1000);
    return () => {
      log("dispose");
    };
  });
  const subscription = promise.subscribe();
  vi.runAllTimers();
  subscription.dispose();
  expect(readLog()).toMatchInlineSnapshot(`[]`);
});

test("teardown function is not called if the lazy promise rejects", () => {
  const promise = new LazyPromise<number>((sink) => {
    setTimeout(() => {
      sink.reject(1);
    }, 1000);
    return () => {
      log("dispose");
    };
  });
  const subscription = promise.subscribe(logConsumer);
  vi.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "1000 ms passed",
      [
        "handleError",
        1,
      ],
    ]
  `);
  subscription.dispose();
  expect(readLog()).toMatchInlineSnapshot(`[]`);
});

test("teardown function called by consumer", () => {
  const promise = new LazyPromise<"a">((sink) => {
    setTimeout(() => {
      sink.resolve("a");
    }, 1000);
    return () => {
      log("dispose");
    };
  });
  const subscription = promise.subscribe({
    resolve: (value) => {
      subscription.dispose();
      log("handleValue", value);
    },
  });
  vi.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "1000 ms passed",
      [
        "handleValue",
        "a",
      ],
    ]
  `);
});

test("error in produce function before settling", () => {
  new LazyPromise(() => {
    throw "oops";
  }).subscribe(logConsumer);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleError",
        "oops",
      ],
    ]
  `);

  new LazyPromise<never>(() => {
    throw "oops1";
  }).subscribe({
    reject: (error) => {
      log("handleError", error);
      throw "oops2";
    },
  });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleError",
        "oops1",
      ],
    ]
  `);
  expect(processMockMicrotaskQueue).toThrow("oops2");

  new LazyPromise<never>(() => {
    throw "oops";
  }).subscribe();
  expect(processMockMicrotaskQueue).toThrow("oops");
});

test("error in produce function after settling", () => {
  const promise = new LazyPromise<number>((sink) => {
    sink.resolve(1);
    throw "oops";
  });
  promise.subscribe(logConsumer);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleValue",
        1,
      ],
    ]
  `);
});

test("error in teardown function", () => {
  const promise = new LazyPromise(() => {
    log("produce");
    return () => {
      throw "oops";
    };
  });
  promise.subscribe(logConsumer).dispose();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "produce",
      ],
    ]
  `);
  expect(processMockMicrotaskQueue).toThrow("oops");
});

test("error in value handler function", () => {
  const promise = new LazyPromise<string>((sink) => {
    setTimeout(() => {
      sink.resolve("value");
    }, 1000);
  });
  promise.subscribe({
    resolve: () => {
      throw "oops 1";
    },
    reject: () => {
      log("handleError");
    },
  });
  promise.subscribe(logConsumer);
  vi.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "1000 ms passed",
      [
        "handleValue",
        "value",
      ],
    ]
  `);
  expect(processMockMicrotaskQueue).toThrow("oops 1");
});

test("error in error handler function", () => {
  const promise = new LazyPromise<string>((sink) => {
    setTimeout(() => {
      sink.reject("error");
    }, 1000);
  });
  promise.subscribe({
    reject: (error) => {
      log("handleError", error);
      throw "oops";
    },
  });
  vi.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "1000 ms passed",
      [
        "handleError",
        "error",
      ],
    ]
  `);
  expect(processMockMicrotaskQueue).toThrow("oops");
});

test("unhandled rejection", () => {
  const promise = new LazyPromise<never>((sink) => {
    setTimeout(() => {
      sink.reject("oops");
    }, 1000);
  });
  promise.subscribe();
  expect(mockMicrotaskQueue.length).toMatchInlineSnapshot(`0`);
  vi.runAllTimers();
  expect(processMockMicrotaskQueue).toThrow("oops");
});

test("already resolved", () => {
  const promise = new LazyPromise<number>((sink) => {
    sink.resolve(1);
    sink.resolve(2);
    sink.reject(3);
    throw 4;
  });
  promise.subscribe(logConsumer);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleValue",
        1,
      ],
    ]
  `);
});

test("already rejected", () => {
  const promise = new LazyPromise<number>((sink) => {
    sink.reject(1);
    sink.resolve(2);
    sink.reject(3);
    throw 4;
  });
  promise.subscribe(logConsumer);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleError",
        1,
      ],
    ]
  `);
});

test("already resolved with a promise", () => {
  const promise = new LazyPromise<number>((sink) => {
    sink.resolve(box(1));
    sink.resolve(2);
    sink.reject(3);
    throw 4;
  });
  promise.subscribe(logConsumer);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleValue",
        1,
      ],
    ]
  `);
});

test("unsubscribed", () => {
  const promise = new LazyPromise<number>((sink) => {
    log("produce");
    setTimeout(() => {
      sink.resolve(2);
      sink.reject(3);
    });
  });
  promise.subscribe(logConsumer).dispose();
  vi.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "produce",
      ],
    ]
  `);
});

test("stack overflow", () => {
  const getMaxStackDepth = (depth = 1) => {
    try {
      return getMaxStackDepth(depth + 1);
    } catch (e) {
      return depth;
    }
  };
  const maxStackDepth = getMaxStackDepth();
  const getInner = (count: number) =>
    new LazyPromise((sink) => {
      sink.resolve(count === 1 ? "value" : getInner(count - 1));
    });
  getInner(maxStackDepth + 10).subscribe(logConsumer);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleValue",
        "value",
      ],
    ]
  `);

  const getInnerWithLogging = (count: number) =>
    new LazyPromise((sink) => {
      log("start", count);
      sink.resolve(count === 1 ? "value" : getInnerWithLogging(count - 1));
      log("end", count);
    });
  getInnerWithLogging(3).subscribe(logConsumer);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "start",
        3,
      ],
      [
        "end",
        3,
      ],
      [
        "start",
        2,
      ],
      [
        "end",
        2,
      ],
      [
        "start",
        1,
      ],
      [
        "handleValue",
        "value",
      ],
      [
        "end",
        1,
      ],
    ]
  `);
});

test("box", () => {
  const promise = box(1);
  expect(promise instanceof LazyPromise).toMatchInlineSnapshot(`true`);
  promise.subscribe(logConsumer);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleValue",
        1,
      ],
    ]
  `);
  promise.subscribe({
    resolve: () => {
      throw "oops";
    },
  });
  expect(processMockMicrotaskQueue).toThrow("oops");
  expect(box(promise)).toBe(promise);
});

test("rejected", () => {
  const promise = rejecting("error");
  expect(promise instanceof LazyPromise).toMatchInlineSnapshot(`true`);
  promise.subscribe(logConsumer);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleError",
        "error",
      ],
    ]
  `);
  promise.subscribe({
    reject: () => {
      throw "oops";
    },
  });
  expect(processMockMicrotaskQueue).toThrow("oops");
  promise.subscribe();
  expect(processMockMicrotaskQueue).toThrow("error");
});

test("never", () => {
  expect(never instanceof LazyPromise).toMatchInlineSnapshot(`true`);
  never.subscribe(logConsumer);
});

test("pipe", () => {
  const promise = new LazyPromise<"value">(() => {});

  const getA = (promiseLocal: LazyPromise<"value">) => {
    if (promiseLocal !== promise) {
      throw new Error();
    }
    return "a" as const;
  };

  expect(promise.pipe(getA)).toMatchInlineSnapshot(`"a"`);
});
