import { box, failed, LazyPromise, never, rejected } from "@lazy-promise/core";
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
  /* eslint-disable @typescript-eslint/no-unused-vars */
  const promise1 = new LazyPromise<"value a", "error a">(() => {});

  promise1.subscribe(undefined, () => {});

  /** @ts-expect-error */
  promise1.subscribe();

  /** @ts-expect-error */
  promise1.subscribe(() => {});

  /** @ts-expect-error */
  promise1.subscribe(() => {}, undefined);

  const promise2 = new LazyPromise<"value a", never>(() => {});

  promise2.subscribe();

  promise2.subscribe(undefined);

  promise2.subscribe(() => {});

  promise2.subscribe(() => {}, undefined);

  // $ExpectType LazyPromise<"a", never>
  const promise3 = box("a");

  // $ExpectType LazyPromise<void, never>
  const promise4 = box();

  // $ExpectType LazyPromise<"value", "error">
  const promise5 = box(new LazyPromise<"value", "error">(() => {}));

  // $ExpectType LazyPromise<"a" | "value", "error">
  const promise6 = box(
    (true as boolean) ? "a" : new LazyPromise<"value", "error">(() => {}),
  );

  // $ExpectType LazyPromise<never, "a">
  const promise7 = rejected("a");

  // $ExpectType LazyPromise<never, void>
  const promise8 = rejected();

  /* eslint-enable @typescript-eslint/no-unused-vars */
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
  const promise = new LazyPromise<unknown, string>((resolve, reject) => {
    setTimeout(() => {
      reject("oops");
    }, 1000);
    return () => {};
  });
  promise.subscribe(undefined, (error) => {
    log("handleRejection", error);
  });
  vi.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "1000 ms passed",
      [
        "handleRejection",
        "oops",
      ],
    ]
  `);
});

test("sync reject", () => {
  const promise = new LazyPromise<unknown, string>((resolve, reject) => {
    log("produce");
    reject("oops");
  });
  expect(
    promise.subscribe(undefined, (error) => {
      log("handleRejection", error);
    }),
  ).toBe(undefined);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "produce",
      ],
      [
        "handleRejection",
        "oops",
      ],
    ]
  `);
});

test("async fail", () => {
  const promise = new LazyPromise<unknown, never>((resolve, reject, fail) => {
    setTimeout(() => {
      fail("oops");
    }, 1000);
    return () => {};
  });
  promise.subscribe(undefined, undefined, (error) => {
    log("handleFailure", error);
  });
  vi.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "1000 ms passed",
      [
        "handleFailure",
        "oops",
      ],
    ]
  `);
});

test("sync fail", () => {
  const promise = new LazyPromise<unknown, never>((resolve, reject, fail) => {
    log("produce");
    fail("oops");
  });
  expect(
    promise.subscribe(undefined, undefined, (error) => {
      log("handleFailure", error);
    }),
  ).toBe(undefined);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "produce",
      ],
      [
        "handleFailure",
        "oops",
      ],
    ]
  `);
});

test("no teardown function", () => {
  const promise = new LazyPromise<unknown, never>(() => {
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
  const promise = new LazyPromise<number, number>((resolve, reject) => {
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

test("teardown function is not called if the lazy promise fails", () => {
  const promise = new LazyPromise<number, never>((resolve, reject, fail) => {
    setTimeout(() => {
      fail(1);
    }, 1000);
    return () => {
      log("dispose");
    };
  });
  const dispose = promise.subscribe(undefined, undefined, () => {});
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
  }).subscribe(undefined, undefined, (error) => {
    log("handleFailure", error);
  });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleFailure",
        "oops",
      ],
    ]
  `);

  new LazyPromise(() => {
    throw "oops1";
  }).subscribe(undefined, undefined, (error) => {
    log("handleFailure", error);
    throw "oops2";
  });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleFailure",
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
  promise.subscribe(undefined, undefined, () => {
    log("handleFailure 1");
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
    undefined,
    () => {
      log("handleFailure");
    },
  );
  promise.subscribe(
    (value) => {
      log("handleValue", value);
    },
    undefined,
    () => {
      log("handleFailure");
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
  const promise = new LazyPromise<string, string>((resolve, reject) => {
    setTimeout(() => {
      reject("error");
    }, 1000);
    return () => {};
  });
  promise.subscribe(
    undefined,
    () => {
      throw "oops 1";
    },
    () => {
      log("handleFailure");
    },
  );
  promise.subscribe(
    undefined,
    (error) => {
      log("handleRejection", error);
    },
    () => {
      log("handleFailure");
    },
  );
  vi.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "1000 ms passed",
      [
        "handleRejection",
        "error",
      ],
    ]
  `);
  expect(processMockMicrotaskQueue).toThrow("oops 1");
});

test("error in failure handler function", () => {
  const promise = new LazyPromise<string, never>((resolve, reject, fail) => {
    setTimeout(() => {
      fail("error");
    }, 1000);
    return () => {};
  });
  promise.subscribe(undefined, undefined, (error) => {
    log("handleFailure", error);
    throw "oops";
  });
  vi.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "1000 ms passed",
      [
        "handleFailure",
        "error",
      ],
    ]
  `);
  expect(processMockMicrotaskQueue).toThrow("oops");
});

test("unhandled rejection", () => {
  const promise = new LazyPromise<unknown, string>((resolve, reject) => {
    setTimeout(() => {
      reject("oops");
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
    `"Unhandled rejection. The original error has been stored as the .cause property."`,
  );
  expect(error.cause).toMatchInlineSnapshot(`"oops"`);
});

test("unhandled failure", () => {
  const promise = new LazyPromise<unknown, never>((resolve, reject, fail) => {
    setTimeout(() => {
      fail("oops");
    }, 1000);
    return () => {};
  });
  promise.subscribe();
  expect(mockMicrotaskQueue.length).toMatchInlineSnapshot(`0`);
  vi.runAllTimers();
  expect(processMockMicrotaskQueue).toThrow("oops");
});

test("already resolved", () => {
  const promise = new LazyPromise<number, number>((resolve, reject, fail) => {
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
    try {
      fail(4);
    } catch (error) {
      if (!(error instanceof Error)) {
        throw new Error("fail");
      }
      log("fail error", error.message, error.cause);
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
        "Tried to reject a resolved lazy promise subscription.",
        undefined,
      ],
      [
        "fail error",
        "Tried to fail a resolved lazy promise subscription with an error that has been stored as this error's .cause property.",
        4,
      ],
    ]
  `);
});

test("already rejected", () => {
  const promise = new LazyPromise<number, number>((resolve, reject, fail) => {
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
    try {
      fail(4);
    } catch (error) {
      if (!(error instanceof Error)) {
        throw new Error("fail");
      }
      log("fail error", error.message, error.cause);
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
        "Tried to reject an already rejected lazy promise subscription.",
        undefined,
      ],
      [
        "fail error",
        "Tried to fail a rejected lazy promise subscription with an error that has been stored as this error's .cause property.",
        4,
      ],
    ]
  `);
});

test("already failed", () => {
  const promise = new LazyPromise<number, number>((resolve, reject, fail) => {
    fail(1);
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
    try {
      fail(4);
    } catch (error) {
      if (!(error instanceof Error)) {
        throw new Error("fail");
      }
      log("fail error", error.message, error.cause);
    }
  });
  promise.subscribe(
    undefined,
    () => {},
    () => {},
  );
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "resolve error",
        "Tried to resolve a failed lazy promise subscription.",
        undefined,
      ],
      [
        "reject error",
        "Tried to reject a failed lazy promise subscription.",
        undefined,
      ],
      [
        "fail error",
        "Tried to fail an already failed lazy promise subscription with an error that has been stored as this error's .cause property.",
        4,
      ],
    ]
  `);
});

test("unsubscribed", () => {
  const promise = new LazyPromise<number, number>((resolve, reject, fail) => {
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
      try {
        fail(4);
      } catch (error) {
        if (!(error instanceof Error)) {
          throw new Error("fail");
        }
        log("fail error", error.message, error.cause);
      }
    });
    return () => {};
  });
  promise.subscribe(
    (value) => {
      log("handleValue 1", value);
    },
    (error) => {
      log("handleRejection 1", error);
    },
    (error) => {
      log("handleFailure 1", error);
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
        "Tried to reject a lazy promise subscription after the teardown function was called.",
        undefined,
      ],
      [
        "fail error",
        "Tried to fail a lazy promise subscription after the teardown function was called. The failure error has been stored as this error's .cause property.",
        4,
      ],
    ]
  `);
});

test("no teardown function", () => {
  const promise = new LazyPromise<number, number>((resolve, reject, fail) => {
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
      try {
        fail(4);
      } catch (error) {
        if (!(error instanceof Error)) {
          throw new Error("fail");
        }
        log("fail error", error.message, error.cause);
      }
    });
  });
  promise.subscribe(
    (value) => {
      log("handleValue 1", value);
    },
    (error) => {
      log("handleRejection 1", error);
    },
    (error) => {
      log("handleFailure 1", error);
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
        "Tried to asynchronously reject a lazy promise subscription that does not have a teardown function.",
        undefined,
      ],
      [
        "fail error",
        "Tried to asynchronously fail a lazy promise subscription that does not have a teardown function. The failure error has been stored as this error's .cause property.",
        4,
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
      log("handleRejection", error);
    }),
  ).toBe(undefined);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleRejection",
        "error",
      ],
    ]
  `);
  promise.subscribe(undefined, () => {
    throw "oops";
  });
  expect(processMockMicrotaskQueue).toThrow("oops");
  // @ts-expect-error
  promise.subscribe();
  expect(processMockMicrotaskQueue).toThrow("error");
});

test("failed", () => {
  const promise = failed("error");
  expect(promise instanceof LazyPromise).toMatchInlineSnapshot(`true`);
  expect(
    promise.subscribe(undefined, undefined, (error) => {
      log("handleFailure", error);
    }),
  ).toBe(undefined);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleFailure",
        "error",
      ],
    ]
  `);
  promise.subscribe(undefined, undefined, () => {
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
        log("handleRejection");
      },
      () => {
        log("handleFailure");
      },
    ),
  ).toBe(undefined);
});

test("pipe", () => {
  const promise = new LazyPromise<"value", "error">(() => {});

  const getA = (promiseLocal: LazyPromise<"value", "error">) => {
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

  // $ExpectType LazyPromise<"value", "error">
  promise.pipe();

  // $ExpectType "a"
  promise.pipe(getA);

  // $ExpectType "a-b"
  promise.pipe(getA, addSuffix("b"));

  // $ExpectType "a-b-c"
  promise.pipe(getA, addSuffix("b"), addSuffix("c"));

  // $ExpectType "a-b-c-d"
  promise.pipe(getA, addSuffix("b"), addSuffix("c"), addSuffix("d"));

  // $ExpectType "a-b-c-d-e"
  promise.pipe(
    getA,
    addSuffix("b"),
    addSuffix("c"),
    addSuffix("d"),
    addSuffix("e"),
  );

  // $ExpectType "a-b-c-d-e-f"
  promise.pipe(
    getA,
    addSuffix("b"),
    addSuffix("c"),
    addSuffix("d"),
    addSuffix("e"),
    addSuffix("f"),
  );

  // $ExpectType "a-b-c-d-e-f-g"
  promise.pipe(
    getA,
    addSuffix("b"),
    addSuffix("c"),
    addSuffix("d"),
    addSuffix("e"),
    addSuffix("f"),
    addSuffix("g"),
  );

  // $ExpectType "a-b-c-d-e-f-g-h"
  promise.pipe(
    getA,
    addSuffix("b"),
    addSuffix("c"),
    addSuffix("d"),
    addSuffix("e"),
    addSuffix("f"),
    addSuffix("g"),
    addSuffix("h"),
  );

  // $ExpectType "a-b-c-d-e-f-g-h-i"
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
  );

  // $ExpectType "a-b-c-d-e-f-g-h-i-j"
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
  );
});
