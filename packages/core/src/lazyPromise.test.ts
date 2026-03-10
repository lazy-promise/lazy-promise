import type {
  InnerSubscriber,
  InnerSubscription,
  Producer,
  Subscriber,
} from "@lazy-promise/core";
import {
  box,
  LazyPromise,
  never,
  rejecting,
  TypedError,
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

test("types", () => {
  const promise1 = new LazyPromise<"value a" | TypedError<"error a">>(() => {});

  promise1.subscribe({ resolve: () => {} });

  /** @ts-expect-error */
  promise1.subscribe();

  /** @ts-expect-error */
  promise1.subscribe({ reject: () => {} });

  /** @ts-expect-error */
  promise1.subscribe(undefined);

  /** @ts-expect-error */
  promise1.subscribe({});

  const promise2 = new LazyPromise<"value a">(() => {});

  promise2.subscribe();

  promise2.subscribe({ reject: () => {} });

  promise2.subscribe(undefined);

  expectTypeOf(box("a")).toEqualTypeOf<LazyPromise<"a">>();

  expectTypeOf(box()).toEqualTypeOf<LazyPromise<void>>();

  expectTypeOf(box(new LazyPromise<"value">(() => {}))).toEqualTypeOf<
    LazyPromise<"value">
  >();

  expectTypeOf(
    box(
      (true as boolean)
        ? "a"
        : new LazyPromise<"value" | TypedError<"error">>(() => {}),
    ),
  ).toEqualTypeOf<LazyPromise<"a" | "value" | TypedError<"error">>>();

  expectTypeOf(rejecting("a")).toEqualTypeOf<LazyPromise<never>>();

  expectTypeOf(rejecting()).toEqualTypeOf<LazyPromise<never>>();

  // Check that typed errors are nominally typed.
  expectTypeOf({ error: "a" }).not.toExtend<TypedError<string>>();

  expectTypeOf<LazyPromise<"a">>().toExtend<LazyPromise<string>>();
  expectTypeOf<LazyPromise<string>>().not.toExtend<LazyPromise<"a">>();

  expectTypeOf<InnerSubscriber<string>>().toExtend<InnerSubscriber<"a">>();
  expectTypeOf<InnerSubscriber<"a">>().not.toExtend<InnerSubscriber<string>>();
});

test("async resolve", () => {
  const promise = new LazyPromise<string>((subscriber) => {
    setTimeout(() => {
      subscriber.resolve("value");
    }, 1000);
    return () => {
      log("dispose");
    };
  });
  promise.subscribe(logSubscriber);
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
    produce(subscriber) {
      expect(this).toBe(producer);
      setTimeout(() => {
        subscriber.resolve("value");
      }, 1000);
      return () => {
        log("dispose");
      };
    },
  };
  const promise = new LazyPromise<string>(producer);
  promise.subscribe(logSubscriber);
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
  const promise = new LazyPromise<string>((subscriber) => {
    setTimeout(() => {
      subscriber.resolve(box("value"));
    }, 1000);
    return () => {
      log("dispose");
    };
  });
  promise.subscribe(logSubscriber);
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
  new LazyPromise<string>((subscriber) => {
    log("produce");
    subscriber.resolve("value");
    return () => {
      log("dispose");
    };
  }).subscribe(logSubscriber);
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
  new LazyPromise<string>((subscriber) => {
    log("produce");
    subscriber.resolve(box("value"));
    return () => {
      log("dispose");
    };
  }).subscribe(logSubscriber);
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
  const promise = new LazyPromise<unknown>((subscriber) => {
    setTimeout(() => {
      subscriber.reject("oops");
    }, 1000);
    return () => {
      log("dispose");
    };
  });
  promise.subscribe(logSubscriber);
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
  new LazyPromise<unknown>((subscriber) => {
    log("produce");
    subscriber.reject("oops");
    return () => {
      log("dispose");
    };
  }).subscribe(logSubscriber);
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
    .unsubscribe();
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
  subscription.unsubscribe();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "dispose",
      ],
    ]
  `);
  subscription.unsubscribe();
  expect(readLog()).toMatchInlineSnapshot(`[]`);
});

test("cancellation (class-based)", () => {
  const innerSubscription: InnerSubscription = {
    unsubscribe() {
      log("dispose");
      expect(this).toBe(innerSubscription);
    },
  };
  const promise = new LazyPromise<string>(() => {
    log("produce");
    return innerSubscription;
  });
  const subscription = promise.subscribe();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "produce",
      ],
    ]
  `);
  subscription.unsubscribe();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "dispose",
      ],
    ]
  `);
  subscription.unsubscribe();
  expect(readLog()).toMatchInlineSnapshot(`[]`);
});

test("unsubscribe from produce", () => {
  const promise = new LazyPromise<string>((subscriber) => {
    setTimeout(() => {
      subscriber.resolve(
        new LazyPromise(() => {
          // eslint-disable-next-line no-use-before-define
          subscription.unsubscribe();
          subscriber.resolve("value");
          return () => {
            log("dispose inner");
          };
        }),
      );
    }, 1000);
    return () => {
      log("dispose outer");
    };
  });
  const subscription = promise.subscribe(logSubscriber);
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

test("unsubscribe from produce (class-based)", () => {
  const innerSubscription: InnerSubscription = {
    unsubscribe() {
      log("dispose inner");
      expect(this).toBe(innerSubscription);
    },
  };
  const promise = new LazyPromise<string>((subscriber) => {
    setTimeout(() => {
      subscriber.resolve(
        new LazyPromise(() => {
          // eslint-disable-next-line no-use-before-define
          subscription.unsubscribe();
          subscriber.resolve("value");
          return innerSubscription;
        }),
      );
    }, 1000);
    return () => {
      log("dispose outer");
    };
  });
  const subscription = promise.subscribe(logSubscriber);
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
  const promise = new LazyPromise<string>((subscriber) => {
    setTimeout(() => {
      subscriber.resolve(
        new LazyPromise(() => {
          // eslint-disable-next-line no-use-before-define
          subscription.unsubscribe();
          subscriber.resolve("value");
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
  const subscription = promise.subscribe(logSubscriber);
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
  const promise = new LazyPromise<string>((subscriber) => {
    setTimeout(() => {
      subscriber.resolve(
        new LazyPromise(() => {
          // eslint-disable-next-line no-use-before-define
          subscription.unsubscribe();
          subscriber.resolve("value");
        }),
      );
    }, 1000);
    return () => {
      log("dispose outer");
    };
  });
  const subscription = promise.subscribe(logSubscriber);
  vi.runAllTimers();
});

test("teardown function is not called if the lazy promise resolves", () => {
  const promise = new LazyPromise<number>((subscriber) => {
    setTimeout(() => {
      subscriber.resolve(1);
    }, 1000);
    return () => {
      log("dispose");
    };
  });
  const subscription = promise.subscribe();
  vi.runAllTimers();
  subscription.unsubscribe();
  expect(readLog()).toMatchInlineSnapshot(`[]`);
});

test("teardown function is not called if the lazy promise rejects", () => {
  const promise = new LazyPromise<number>((subscriber) => {
    setTimeout(() => {
      subscriber.reject(1);
    }, 1000);
    return () => {
      log("dispose");
    };
  });
  const subscription = promise.subscribe(logSubscriber);
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
  subscription.unsubscribe();
  expect(readLog()).toMatchInlineSnapshot(`[]`);
});

test("teardown function called by consumer", () => {
  const promise = new LazyPromise<"a">((subscriber) => {
    setTimeout(() => {
      subscriber.resolve("a");
    }, 1000);
    return () => {
      log("dispose");
    };
  });
  const subscription = promise.subscribe({
    resolve: (value) => {
      subscription.unsubscribe();
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
  }).subscribe(logSubscriber);
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
  const promise = new LazyPromise<number>((subscriber) => {
    subscriber.resolve(1);
    throw "oops";
  });
  promise.subscribe(logSubscriber);
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
  promise.subscribe(logSubscriber).unsubscribe();
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
  const promise = new LazyPromise<string>((subscriber) => {
    setTimeout(() => {
      subscriber.resolve("value");
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
  promise.subscribe(logSubscriber);
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
  const promise = new LazyPromise<string>((subscriber) => {
    setTimeout(() => {
      subscriber.reject("error");
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

test("unhandled typed error", () => {
  const promise = new LazyPromise<TypedError<"oops">>((subscriber) => {
    setTimeout(() => {
      subscriber.resolve(new TypedError("oops"));
    }, 1000);
  });
  // @ts-expect-error
  promise.subscribe();
  expect(mockMicrotaskQueue.length).toMatchInlineSnapshot(`0`);
  vi.runAllTimers();
  let error;
  try {
    processMockMicrotaskQueue();
  } catch (errorLocal) {
    error = errorLocal;
  }
  expect(error).toMatchInlineSnapshot(`
    TypedError {
      "error": "oops",
    }
  `);
});

test("unhandled error", () => {
  const promise = new LazyPromise<never>((subscriber) => {
    setTimeout(() => {
      subscriber.reject("oops");
    }, 1000);
  });
  promise.subscribe();
  expect(mockMicrotaskQueue.length).toMatchInlineSnapshot(`0`);
  vi.runAllTimers();
  expect(processMockMicrotaskQueue).toThrow("oops");
});

test("already resolved", () => {
  const promise = new LazyPromise<number>((subscriber) => {
    subscriber.resolve(1);
    subscriber.resolve(2);
    subscriber.reject(3);
    throw 4;
  });
  promise.subscribe(logSubscriber);
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
  const promise = new LazyPromise<number>((subscriber) => {
    subscriber.reject(1);
    subscriber.resolve(2);
    subscriber.reject(3);
    throw 4;
  });
  promise.subscribe(logSubscriber);
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
  const promise = new LazyPromise<number>((subscriber) => {
    subscriber.resolve(box(1));
    subscriber.resolve(2);
    subscriber.reject(3);
    throw 4;
  });
  promise.subscribe(logSubscriber);
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
  const promise = new LazyPromise<number>((subscriber) => {
    log("produce");
    setTimeout(() => {
      subscriber.resolve(2);
      subscriber.reject(3);
    });
  });
  promise.subscribe(logSubscriber).unsubscribe();
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
    new LazyPromise((subscriber) => {
      subscriber.resolve(count === 1 ? "value" : getInner(count - 1));
    });
  getInner(maxStackDepth + 10).subscribe(logSubscriber);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleValue",
        "value",
      ],
    ]
  `);

  const getInnerWithLogging = (count: number) =>
    new LazyPromise((subscriber) => {
      log("start", count);
      subscriber.resolve(
        count === 1 ? "value" : getInnerWithLogging(count - 1),
      );
      log("end", count);
    });
  getInnerWithLogging(3).subscribe(logSubscriber);
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
  promise.subscribe(logSubscriber);
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
  promise.subscribe(logSubscriber);
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
  never.subscribe(logSubscriber);
});

test("pipe", () => {
  const promise = new LazyPromise<"value">(() => {});

  const getA = (promiseLocal: LazyPromise<"value">) => {
    if (promiseLocal !== promise) {
      throw new Error();
    }
    return "a" as const;
  };

  const addSuffix =
    <Suffix extends string>(suffix: Suffix) =>
    <Base extends string>(base: Base): `${Base}-${Suffix}` =>
      `${base}-${suffix}`;

  expect(promise.pipe()).toBe(promise);
  expect(promise.pipe(getA)).toMatchInlineSnapshot(`"a"`);
  expect(promise.pipe(getA, addSuffix("b"))).toMatchInlineSnapshot(`"a-b"`);

  expectTypeOf(promise.pipe()).toEqualTypeOf<LazyPromise<"value">>();

  expectTypeOf(promise.pipe(getA)).toEqualTypeOf<"a">();

  expectTypeOf(promise.pipe(getA, addSuffix("b"))).toEqualTypeOf<"a-b">();

  expectTypeOf(
    promise.pipe(getA, addSuffix("b"), addSuffix("c")),
  ).toEqualTypeOf<"a-b-c">();

  expectTypeOf(
    promise.pipe(getA, addSuffix("b"), addSuffix("c"), addSuffix("d")),
  ).toEqualTypeOf<"a-b-c-d">();

  expectTypeOf(
    promise.pipe(
      getA,
      addSuffix("b"),
      addSuffix("c"),
      addSuffix("d"),
      addSuffix("e"),
    ),
  ).toEqualTypeOf<"a-b-c-d-e">();

  expectTypeOf(
    promise.pipe(
      getA,
      addSuffix("b"),
      addSuffix("c"),
      addSuffix("d"),
      addSuffix("e"),
      addSuffix("f"),
    ),
  ).toEqualTypeOf<"a-b-c-d-e-f">();

  expectTypeOf(
    promise.pipe(
      getA,
      addSuffix("b"),
      addSuffix("c"),
      addSuffix("d"),
      addSuffix("e"),
      addSuffix("f"),
      addSuffix("g"),
    ),
  ).toEqualTypeOf<"a-b-c-d-e-f-g">();

  expectTypeOf(
    promise.pipe(
      getA,
      addSuffix("b"),
      addSuffix("c"),
      addSuffix("d"),
      addSuffix("e"),
      addSuffix("f"),
      addSuffix("g"),
      addSuffix("h"),
    ),
  ).toEqualTypeOf<"a-b-c-d-e-f-g-h">();

  expectTypeOf(
    promise.pipe(
      getA,
      addSuffix("b"),
      addSuffix("c"),
      addSuffix("d"),
      addSuffix("e"),
      addSuffix("f"),
      addSuffix("g"),
      addSuffix("h"),
      addSuffix("i"),
    ),
  ).toEqualTypeOf<"a-b-c-d-e-f-g-h-i">();

  expectTypeOf(
    promise.pipe(
      getA,
      addSuffix("b"),
      addSuffix("c"),
      addSuffix("d"),
      addSuffix("e"),
      addSuffix("f"),
      addSuffix("g"),
      addSuffix("h"),
      addSuffix("i"),
      addSuffix("j"),
    ),
  ).toEqualTypeOf<"a-b-c-d-e-f-g-h-i-j">();
});
