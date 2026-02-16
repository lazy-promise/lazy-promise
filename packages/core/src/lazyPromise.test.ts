import {
  box,
  LazyPromise,
  never,
  rejected,
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

  promise1.subscribe(() => {});

  /** @ts-expect-error */
  promise1.subscribe();

  /** @ts-expect-error */
  promise1.subscribe(undefined, () => {});

  /** @ts-expect-error */
  promise1.subscribe(undefined);

  const promise2 = new LazyPromise<"value a">(() => {});

  promise2.subscribe();

  promise2.subscribe(undefined, () => {});

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

  expectTypeOf(rejected("a")).toEqualTypeOf<LazyPromise<never>>();

  expectTypeOf(rejected()).toEqualTypeOf<LazyPromise<never>>();

  // Check that typed errors are nominally typed.
  expectTypeOf({ error: "a" }).not.toExtend<TypedError<string>>();
});

test("async resolve", () => {
  const promise = new LazyPromise<string>((resolve) => {
    setTimeout(() => {
      resolve("value");
    }, 1000);
    return () => {};
  });
  promise.subscribe((value) => {
    log("handleValue", value);
  });
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
  const promise = new LazyPromise<string>((resolve) => {
    log("produce");
    resolve("value");
  });
  expect(
    promise.subscribe((value) => {
      log("handleValue", value);
    }),
  ).toBe(undefined);
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
  const promise = new LazyPromise<unknown>((resolve, reject) => {
    setTimeout(() => {
      reject("oops");
    }, 1000);
    return () => {};
  });
  promise.subscribe(undefined, (error) => {
    log("handleError", error);
  });
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
  const promise = new LazyPromise<unknown>((resolve, reject) => {
    log("produce");
    reject("oops");
  });
  expect(
    promise.subscribe(undefined, (error) => {
      log("handleError", error);
    }),
  ).toBe(undefined);
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
  const promise = new LazyPromise<unknown>(() => {
    log("produce");
  });
  expect(promise.subscribe()).toBe(undefined);
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
  const unsubscribe = promise.subscribe();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "produce",
      ],
    ]
  `);
  unsubscribe!();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "dispose",
      ],
    ]
  `);
  unsubscribe!();
  expect(readLog()).toMatchInlineSnapshot(`[]`);
});

test("teardown function is not called if the lazy promise resolves", () => {
  const promise = new LazyPromise<number>((resolve) => {
    setTimeout(() => {
      resolve(1);
    }, 1000);
    return () => {
      log("dispose");
    };
  });
  const dispose = promise.subscribe();
  vi.runAllTimers();
  dispose!();
  expect(readLog()).toMatchInlineSnapshot(`[]`);
});

test("teardown function is not called if the lazy promise rejects", () => {
  const promise = new LazyPromise<number>((resolve, reject) => {
    setTimeout(() => {
      reject(1);
    }, 1000);
    return () => {
      log("dispose");
    };
  });
  const dispose = promise.subscribe(undefined, () => {});
  vi.runAllTimers();
  dispose!();
  expect(readLog()).toMatchInlineSnapshot(`[]`);
});

test("teardown function called by consumer", () => {
  const promise = new LazyPromise<"a">((resolve) => {
    setTimeout(() => {
      resolve("a");
    }, 1000);
    return () => {
      log("dispose");
    };
  });
  const dispose = promise.subscribe(() => {
    dispose!();
    log("handleValue");
  });
  vi.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "1000 ms passed",
      [
        "handleValue",
      ],
    ]
  `);
});

test("error in produce function before settling", () => {
  new LazyPromise(() => {
    throw "oops";
  }).subscribe(undefined, (error) => {
    log("handleError", error);
  });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleError",
        "oops",
      ],
    ]
  `);

  new LazyPromise(() => {
    throw "oops1";
  }).subscribe(undefined, (error) => {
    log("handleError", error);
    throw "oops2";
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

  new LazyPromise(() => {
    throw "oops";
  }).subscribe();
  expect(processMockMicrotaskQueue).toThrow("oops");
});

test("error in produce function after settling", () => {
  const promise = new LazyPromise<number>((resolve) => {
    resolve(1);
    throw "oops";
  });
  promise.subscribe((value) => {
    log("handleValue", value);
  });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleValue",
        1,
      ],
    ]
  `);
  let error;
  try {
    processMockMicrotaskQueue();
  } catch (errorLocal) {
    error = errorLocal as Error;
  }
  if (!(error instanceof Error)) {
    throw new Error("fail");
  }
  expect(error.message).toMatchInlineSnapshot(
    `"A lazy promise constructor callback threw an error after having previously resolved the subscription. The error has been stored as this error's .cause property."`,
  );
  expect(error.cause).toMatchInlineSnapshot(`"oops"`);
});

test("error in teardown function", () => {
  const promise = new LazyPromise(() => {
    log("produce");
    return () => {
      throw "oops";
    };
  });
  promise.subscribe(undefined, () => {
    log("handleError 1");
  })!();
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
  const promise = new LazyPromise<string>((resolve) => {
    setTimeout(() => {
      resolve("value");
    }, 1000);
    return () => {};
  });
  promise.subscribe(
    () => {
      throw "oops 1";
    },
    () => {
      log("handleError");
    },
  );
  promise.subscribe(
    (value) => {
      log("handleValue", value);
    },
    () => {
      log("handleError");
    },
  );
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
  const promise = new LazyPromise<string>((resolve, reject) => {
    setTimeout(() => {
      reject("error");
    }, 1000);
    return () => {};
  });
  promise.subscribe(undefined, (error) => {
    log("handleError", error);
    throw "oops";
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
  const promise = new LazyPromise<TypedError<"oops">>((resolve) => {
    setTimeout(() => {
      resolve(new TypedError("oops"));
    }, 1000);
    return () => {};
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
  if (!(error instanceof Error)) {
    throw new Error("fail");
  }
  expect(error.message).toMatchInlineSnapshot(
    `"Unhandled typed error. The original error has been stored as the .cause property."`,
  );
  expect(error.cause).toMatchInlineSnapshot(`"oops"`);
});

test("unhandled error", () => {
  const promise = new LazyPromise<unknown>((resolve, reject) => {
    setTimeout(() => {
      reject("oops");
    }, 1000);
    return () => {};
  });
  promise.subscribe();
  expect(mockMicrotaskQueue.length).toMatchInlineSnapshot(`0`);
  vi.runAllTimers();
  expect(processMockMicrotaskQueue).toThrow("oops");
});

test("already resolved", () => {
  const promise = new LazyPromise<number>((resolve, reject) => {
    resolve(1);
    try {
      resolve(2);
    } catch (error) {
      if (!(error instanceof Error)) {
        throw new Error("fail");
      }
      log("resolve error", error.message, error.cause);
    }
    try {
      reject(3);
    } catch (error) {
      if (!(error instanceof Error)) {
        throw new Error("fail");
      }
      log("reject error", error.message, error.cause);
    }
  });
  promise.subscribe(undefined, () => {});
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "resolve error",
        "Tried to resolve an already resolved lazy promise subscription.",
        undefined,
      ],
      [
        "reject error",
        "Tried to reject a resolved lazy promise subscription with an error that has been stored as this error's .cause property.",
        3,
      ],
    ]
  `);
});

test("already rejected", () => {
  const promise = new LazyPromise<number>((resolve, reject) => {
    reject(1);
    try {
      resolve(2);
    } catch (error) {
      if (!(error instanceof Error)) {
        throw new Error("fail");
      }
      log("resolve error", error.message, error.cause);
    }
    try {
      reject(3);
    } catch (error) {
      if (!(error instanceof Error)) {
        throw new Error("fail");
      }
      log("reject error", error.message, error.cause);
    }
  });
  promise.subscribe(undefined, () => {});
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "resolve error",
        "Tried to resolve a rejected lazy promise subscription.",
        undefined,
      ],
      [
        "reject error",
        "Tried to reject an already rejected lazy promise subscription with an error that has been stored as this error's .cause property.",
        3,
      ],
    ]
  `);
});

test("unsubscribed", () => {
  const promise = new LazyPromise<number>((resolve, reject) => {
    log("produce");
    setTimeout(() => {
      try {
        resolve(2);
      } catch (error) {
        if (!(error instanceof Error)) {
          throw new Error("fail");
        }
        log("resolve error", error.message, error.cause);
      }
      try {
        reject(3);
      } catch (error) {
        if (!(error instanceof Error)) {
          throw new Error("fail");
        }
        log("reject error", error.message, error.cause);
      }
    });
    return () => {};
  });
  promise.subscribe(
    (value) => {
      log("handleValue", value);
    },
    (error) => {
      log("handleError", error);
    },
  )!();
  vi.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "produce",
      ],
      [
        "resolve error",
        "Tried to resolve a lazy promise subscription after the teardown function was called.",
        undefined,
      ],
      [
        "reject error",
        "Tried to reject a lazy promise subscription after the teardown function was called. The rejection error has been stored as this error's .cause property.",
        3,
      ],
    ]
  `);
});

test("no teardown function", () => {
  const promise = new LazyPromise<number>((resolve, reject) => {
    log("produce");
    setTimeout(() => {
      try {
        resolve(2);
      } catch (error) {
        if (!(error instanceof Error)) {
          throw new Error("fail");
        }
        log("resolve error", error.message, error.cause);
      }
      try {
        reject(3);
      } catch (error) {
        if (!(error instanceof Error)) {
          throw new Error("fail");
        }
        log("reject error", error.message, error.cause);
      }
    });
  });
  promise.subscribe(
    (value) => {
      log("handleValue", value);
    },
    (error) => {
      log("handleError", error);
    },
  );
  vi.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "produce",
      ],
      [
        "resolve error",
        "Tried to asynchronously resolve a lazy promise subscription that does not have a teardown function.",
        undefined,
      ],
      [
        "reject error",
        "Tried to asynchronously reject a lazy promise subscription that does not have a teardown function. The rejection error has been stored as this error's .cause property.",
        3,
      ],
    ]
  `);
});

test("box", () => {
  const promise = box(1);
  expect(promise instanceof LazyPromise).toMatchInlineSnapshot(`true`);
  expect(
    promise.subscribe((value) => {
      log("handleValue", value);
    }),
  ).toBe(undefined);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleValue",
        1,
      ],
    ]
  `);
  promise.subscribe(() => {
    throw "oops";
  });
  expect(processMockMicrotaskQueue).toThrow("oops");
  expect(box(promise)).toBe(promise);
});

test("rejected", () => {
  const promise = rejected("error");
  expect(promise instanceof LazyPromise).toMatchInlineSnapshot(`true`);
  expect(
    promise.subscribe(undefined, (error) => {
      log("handleError", error);
    }),
  ).toBe(undefined);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleError",
        "error",
      ],
    ]
  `);
  promise.subscribe(undefined, () => {
    throw "oops";
  });
  expect(processMockMicrotaskQueue).toThrow("oops");
  promise.subscribe();
  expect(processMockMicrotaskQueue).toThrow("error");
});

test("never", () => {
  expect(never instanceof LazyPromise).toMatchInlineSnapshot(`true`);
  expect(
    never.subscribe(
      () => {
        log("handleValue");
      },
      () => {
        log("handleError");
      },
    ),
  ).toBe(undefined);
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
