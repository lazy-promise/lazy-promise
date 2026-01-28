import {
  box,
  failed,
  LazyPromise,
  never,
  noopUnsubscribe,
  rejected,
} from "@lazy-promise/core";
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
      log("handleValue 1", value);
    }),
  ).toBe(noopUnsubscribe);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "produce",
      ],
      [
        "handleValue 1",
        "value",
      ],
    ]
  `);
  expect(
    promise.subscribe((value) => {
      log("handleValue 2", value);
    }),
  ).toBe(noopUnsubscribe);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleValue 2",
        "value",
      ],
    ]
  `);
  promise.subscribe();
  expect(readLog()).toMatchInlineSnapshot(`[]`);
});

test("async reject", () => {
  const promise = new LazyPromise<unknown, string>((resolve, reject) => {
    setTimeout(() => {
      reject("oops");
    }, 1000);
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
      log("handleRejection 1", error);
    }),
  ).toBe(noopUnsubscribe);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "produce",
      ],
      [
        "handleRejection 1",
        "oops",
      ],
    ]
  `);
  expect(
    promise.subscribe(undefined, (error) => {
      log("handleRejection 2", error);
    }),
  ).toBe(noopUnsubscribe);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleRejection 2",
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
      log("handleFailure 1", error);
    }),
  ).toBe(noopUnsubscribe);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "produce",
      ],
      [
        "handleFailure 1",
        "oops",
      ],
    ]
  `);
  expect(
    promise.subscribe(undefined, undefined, (error) => {
      log("handleFailure 2", error);
    }),
  ).toBe(noopUnsubscribe);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleFailure 2",
        "oops",
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
  const a = promise.subscribe();
  const b = promise.subscribe();
  const c = promise.subscribe();
  a();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "produce",
      ],
    ]
  `);
  a();
  expect(readLog()).toMatchInlineSnapshot(`[]`);
  b();
  expect(readLog()).toMatchInlineSnapshot(`[]`);
  b();
  expect(readLog()).toMatchInlineSnapshot(`[]`);
  c();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "dispose",
      ],
    ]
  `);
  c();
  expect(readLog()).toMatchInlineSnapshot(`[]`);
  const d = promise.subscribe();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "produce",
      ],
    ]
  `);
  d();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "dispose",
      ],
    ]
  `);
});

test("linked list of subscribers: first entry", () => {
  let resolve: (value: string) => void;
  const promise = new LazyPromise<string>((resolveLocal) => {
    resolve = resolveLocal;
    log("produce");
    return () => {
      log("dispose");
    };
  });
  const a = promise.subscribe((value) => {
    log("subscriber a handleValue", value);
  });
  promise.subscribe((value) => {
    log("subscriber b handleValue", value);
  });
  promise.subscribe((value) => {
    log("subscriber c handleValue", value);
  });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "produce",
      ],
    ]
  `);
  a();
  expect(readLog()).toMatchInlineSnapshot(`[]`);
  resolve!("value");
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "subscriber c handleValue",
        "value",
      ],
      [
        "subscriber b handleValue",
        "value",
      ],
    ]
  `);
});

test("linked list of subscribers: middle entry", () => {
  let resolve: (value: string) => void;
  const promise = new LazyPromise<string>((resolveLocal) => {
    resolve = resolveLocal;
    log("produce");
    return () => {
      log("dispose");
    };
  });
  promise.subscribe((value) => {
    log("subscriber a handleValue", value);
  });
  const b = promise.subscribe((value) => {
    log("subscriber b handleValue", value);
  });
  promise.subscribe((value) => {
    log("subscriber c handleValue", value);
  });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "produce",
      ],
    ]
  `);
  b();
  expect(readLog()).toMatchInlineSnapshot(`[]`);
  resolve!("value");
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "subscriber c handleValue",
        "value",
      ],
      [
        "subscriber a handleValue",
        "value",
      ],
    ]
  `);
});

test("linked list of subscribers: last entry", () => {
  let resolve: (value: string) => void;
  const promise = new LazyPromise<string>((resolveLocal) => {
    resolve = resolveLocal;
    log("produce");
    return () => {
      log("dispose");
    };
  });
  promise.subscribe((value) => {
    log("subscriber a handleValue", value);
  });
  promise.subscribe((value) => {
    log("subscriber b handleValue", value);
  });
  const c = promise.subscribe((value) => {
    log("subscriber c handleValue", value);
  });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "produce",
      ],
    ]
  `);
  c();
  expect(readLog()).toMatchInlineSnapshot(`[]`);
  resolve!("value");
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "subscriber b handleValue",
        "value",
      ],
      [
        "subscriber a handleValue",
        "value",
      ],
    ]
  `);
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
  dispose();
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
  dispose();
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
  dispose();
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
    dispose();
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
  const promise = new LazyPromise(() => {
    throw "oops";
  });
  promise.subscribe(undefined, undefined, (error) => {
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
});

test("error in produce function after settling", () => {
  const promise = new LazyPromise<number>((resolve) => {
    resolve(1);
    throw "oops";
  });
  promise.subscribe(
    (value) => {
      log("handleValue", value);
    },
    undefined,
    () => {
      log("handleFailure");
    },
  );
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleValue",
        1,
      ],
    ]
  `);
  expect(processMockMicrotaskQueue).toThrow("oops");
  promise.subscribe(
    (value) => {
      log("handleValue", value);
    },
    undefined,
    () => {
      log("handleFailure");
    },
  );
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
  promise.subscribe(undefined, undefined, () => {
    log("handleFailure 1");
  })();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "produce",
      ],
    ]
  `);
  expect(processMockMicrotaskQueue).toThrow("oops");
  promise.subscribe(undefined, undefined, (error) => {
    log("handleFailure 2", error);
  });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleFailure 2",
        "oops",
      ],
    ]
  `);
});

test("error in value handler function", () => {
  const promise = new LazyPromise<string>((resolve) => {
    setTimeout(() => {
      resolve("value");
    }, 1000);
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
  promise.subscribe(() => {
    throw "oops 2";
  });
  expect(processMockMicrotaskQueue).toThrow("oops 2");
});

test("error in error handler function", () => {
  const promise = new LazyPromise<string, string>((resolve, reject) => {
    setTimeout(() => {
      reject("error");
    }, 1000);
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
  promise.subscribe(undefined, () => {
    throw "oops 2";
  });
  expect(processMockMicrotaskQueue).toThrow("oops 2");
});

test("error in failure handler function", () => {
  const promise = new LazyPromise<string, never>((resolve, reject, fail) => {
    setTimeout(() => {
      fail("error");
    }, 1000);
  });
  promise.subscribe(undefined, undefined, (error) => {
    log("handleFailure 1", error);
    throw "oops 1";
  });
  promise.subscribe(undefined, undefined, (error) => {
    log("handleFailure 2", error);
  });
  vi.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "1000 ms passed",
      [
        "handleFailure 2",
        "error",
      ],
      [
        "handleFailure 1",
        "error",
      ],
    ]
  `);
  expect(processMockMicrotaskQueue).toThrow("oops 1");
  promise.subscribe(undefined, undefined, (error) => {
    log("handleFailure 3", error);
    throw "oops 2";
  });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleFailure 3",
        "error",
      ],
    ]
  `);
  expect(processMockMicrotaskQueue).toThrow("oops 2");
});

test("unhandled rejection", () => {
  const promise = new LazyPromise<unknown, string>((resolve, reject) => {
    setTimeout(() => {
      reject("oops");
    }, 1000);
  });
  // @ts-expect-error
  promise.subscribe();

  // Make sure there is a type error in all cases.
  // @ts-expect-error
  promise.subscribe(undefined);
  // @ts-expect-error
  promise.subscribe(undefined, undefined);
  // @ts-expect-error
  promise.subscribe(() => {});
  // @ts-expect-error
  promise.subscribe(() => {}, undefined);

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
  // Only one error is thrown.
  processMockMicrotaskQueue();
  // @ts-expect-error
  promise.subscribe();
  error = undefined;
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
  const promise = new LazyPromise<unknown, string>((resolve, reject, fail) => {
    setTimeout(() => {
      fail("oops");
    }, 1000);
  });
  // @ts-expect-error
  promise.subscribe();

  // Make sure there is a type error in all cases.
  // @ts-expect-error
  promise.subscribe(undefined);
  // @ts-expect-error
  promise.subscribe(undefined, undefined);
  // @ts-expect-error
  promise.subscribe(() => {});
  // @ts-expect-error
  promise.subscribe(() => {}, undefined);

  expect(mockMicrotaskQueue.length).toMatchInlineSnapshot(`0`);
  vi.runAllTimers();
  expect(processMockMicrotaskQueue).toThrow("oops");
  // Only one error is thrown.
  processMockMicrotaskQueue();
  // @ts-expect-error
  promise.subscribe();
  expect(processMockMicrotaskQueue).toThrow("oops");
});

test("already resolved", () => {
  const promise = new LazyPromise<number, number>((resolve, reject, fail) => {
    resolve(1);
    try {
      resolve(2);
    } catch (error) {
      log("resolve error", error);
    }
    try {
      reject(1);
    } catch (error) {
      log("reject error", error);
    }
    try {
      fail(1);
    } catch (error) {
      log("fail error", error);
    }
  });
  promise.subscribe(undefined, () => {});
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "resolve error",
        [Error: You cannot resolve an already resolved lazy promise.],
      ],
      [
        "reject error",
        [Error: You cannot reject a resolved lazy promise.],
      ],
      [
        "fail error",
        [Error: You cannot fail a resolved lazy promise.],
      ],
    ]
  `);
});

test("already rejected", () => {
  const promise = new LazyPromise<number, number>((resolve, reject, fail) => {
    reject(1);
    try {
      resolve(1);
    } catch (error) {
      log("resolve error", error);
    }
    try {
      reject(2);
    } catch (error) {
      log("reject error", error);
    }
    try {
      fail(1);
    } catch (error) {
      log("fail error", error);
    }
  });
  promise.subscribe(undefined, () => {});
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "resolve error",
        [Error: You cannot resolve a rejected lazy promise.],
      ],
      [
        "reject error",
        [Error: You cannot reject an already rejected lazy promise.],
      ],
      [
        "fail error",
        [Error: You cannot fail a rejected lazy promise.],
      ],
    ]
  `);
});

test("already failed", () => {
  const promise = new LazyPromise<number, number>((resolve, reject, fail) => {
    fail(1);
    try {
      resolve(1);
    } catch (error) {
      log("resolve error", error);
    }
    try {
      reject(2);
    } catch (error) {
      log("reject error", error);
    }
    try {
      fail(2);
    } catch (error) {
      log("fail error", error);
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
        [Error: You cannot resolve a failed lazy promise.],
      ],
      [
        "reject error",
        [Error: You cannot reject a failed lazy promise.],
      ],
      [
        "fail error",
        [Error: You cannot fail an already failed lazy promise.],
      ],
    ]
  `);
});

test("no subscribers", () => {
  const promise = new LazyPromise<number, number>((resolve, reject, fail) => {
    log("produce");
    setTimeout(() => {
      try {
        resolve(1);
      } catch (error) {
        log("resolve error", error);
      }
      try {
        reject(1);
      } catch (error) {
        log("reject error", error);
      }
      try {
        fail(1);
      } catch (error) {
        log("fail error", error);
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
  )();
  vi.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "produce",
      ],
      [
        "resolve error",
        [Error: You cannot resolve a lazy promise that no longer has any subscribers. This error indicates that the lazy promise has not been fully torn down. Make sure that the callback you're passing to the LazyPromise constructor returns a working teardown function.],
      ],
      [
        "reject error",
        [Error: You cannot reject a lazy promise that no longer has any subscribers. This error indicates that the lazy promise has not been fully torn down. Make sure that the callback you're passing to the LazyPromise constructor returns a working teardown function.],
      ],
      [
        "fail error",
        [Error: You cannot fail a lazy promise that no longer has any subscribers. This error indicates that the lazy promise has not been fully torn down. Make sure that the callback you're passing to the LazyPromise constructor returns a working teardown function.],
      ],
    ]
  `);
});

test("subscribe in teardown function", () => {
  const promise = new LazyPromise(() => () => {
    try {
      promise.subscribe();
    } catch (error) {
      log("subscribe error", error);
    }
  });
  promise.subscribe()();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "subscribe error",
        [Error: You cannot subscribe to a lazy promise while its teardown function is running.],
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
  ).toBe(noopUnsubscribe);
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
  })();
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
  ).toBe(noopUnsubscribe);
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
  })();
  expect(processMockMicrotaskQueue).toThrow("oops");
  // @ts-expect-error
  const dispose = promise.subscribe();
  dispose();
  expect(processMockMicrotaskQueue).toThrow("error");
});

test("failed", () => {
  const promise = failed("error");
  expect(promise instanceof LazyPromise).toMatchInlineSnapshot(`true`);
  expect(
    promise.subscribe(undefined, undefined, (error) => {
      log("handleFailure", error);
    }),
  ).toBe(noopUnsubscribe);
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
  })();
  expect(processMockMicrotaskQueue).toThrow("oops");
  const dispose = promise.subscribe();
  dispose();
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
  ).not.toBe(noopUnsubscribe);
  expect(readLog()).toMatchInlineSnapshot(`[]`);
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
