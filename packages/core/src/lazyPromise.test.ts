import { afterEach, beforeEach, expect, jest, test } from "@jest/globals";
import {
  createLazyPromise,
  failed,
  isLazyPromise,
  never,
  noopUnsubscribe,
  rejected,
  resolved,
} from "./lazyPromise";

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
  jest.useFakeTimers();
  logTime = Date.now();
  global.queueMicrotask = (task) => mockMicrotaskQueue.push(task);
});

afterEach(() => {
  processMockMicrotaskQueue();
  global.queueMicrotask = originalQueueMicrotask;
  jest.useRealTimers();
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
  const promise1 = createLazyPromise<"value a", "error a">(() => {});

  promise1.subscribe(undefined, () => {});

  /** @ts-expect-error */
  promise1.subscribe();

  /** @ts-expect-error */
  promise1.subscribe(() => {}, undefined);

  const promise2 = createLazyPromise<"value a", never>(() => {});

  promise2.subscribe();

  promise2.subscribe(() => {}, undefined);

  // $ExpectType LazyPromise<"a", never>
  const promise3 = resolved("a");

  // $ExpectType LazyPromise<never, "a">
  const promise4 = rejected("a");

  /* eslint-enable @typescript-eslint/no-unused-vars */
});

test("async resolve", () => {
  const promise = createLazyPromise<string>((resolve) => {
    setTimeout(() => {
      resolve("value");
    }, 1000);
  });
  promise.subscribe((value) => {
    log("handleValue", value);
  });
  jest.runAllTimers();
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
  const promise = createLazyPromise<string>((resolve) => {
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
  const promise = createLazyPromise<unknown, string>((resolve, reject) => {
    setTimeout(() => {
      reject("oops");
    }, 1000);
  });
  promise.subscribe(undefined, (error) => {
    log("handleError", error);
  });
  jest.runAllTimers();
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
  const promise = createLazyPromise<unknown, string>((resolve, reject) => {
    log("produce");
    reject("oops");
  });
  expect(
    promise.subscribe(undefined, (error) => {
      log("handleError 1", error);
    }),
  ).toBe(noopUnsubscribe);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "produce",
      ],
      [
        "handleError 1",
        "oops",
      ],
    ]
  `);
  expect(
    promise.subscribe(undefined, (error) => {
      log("handleError 2", error);
    }),
  ).toBe(noopUnsubscribe);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleError 2",
        "oops",
      ],
    ]
  `);
});

test("async fail", () => {
  const promise = createLazyPromise<unknown, never>((resolve, reject, fail) => {
    setTimeout(() => {
      fail("oops");
    }, 1000);
  });
  promise.subscribe(undefined, undefined, (error) => {
    log("handleFailure", error);
  });
  jest.runAllTimers();
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
  const promise = createLazyPromise<unknown, never>((resolve, reject, fail) => {
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
  const promise = createLazyPromise<string>(() => {
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

test("teardown function is not called if the lazy promise resolves", () => {
  const promise = createLazyPromise<number>((resolve) => {
    setTimeout(() => {
      resolve(1);
    }, 1000);
    return () => {
      log("dispose");
    };
  });
  const dispose = promise.subscribe();
  jest.runAllTimers();
  dispose();
  expect(readLog()).toMatchInlineSnapshot(`[]`);
});

test("teardown function is not called if the lazy promise rejects", () => {
  const promise = createLazyPromise<number, number>((resolve, reject) => {
    setTimeout(() => {
      reject(1);
    }, 1000);
    return () => {
      log("dispose");
    };
  });
  const dispose = promise.subscribe(undefined, () => {});
  jest.runAllTimers();
  dispose();
  expect(readLog()).toMatchInlineSnapshot(`[]`);
});

test("teardown function is not called if the lazy promise fails", () => {
  const promise = createLazyPromise<number, never>((resolve, reject, fail) => {
    setTimeout(() => {
      fail(1);
    }, 1000);
    return () => {
      log("dispose");
    };
  });
  const dispose = promise.subscribe(undefined, undefined, () => {});
  jest.runAllTimers();
  dispose();
  expect(readLog()).toMatchInlineSnapshot(`[]`);
});

test("teardown function called by consumer", () => {
  const promise = createLazyPromise<"a">((resolve) => {
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
  jest.runAllTimers();
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
  const promise = createLazyPromise(() => {
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
  const promise = createLazyPromise<number>((resolve) => {
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
  const promise = createLazyPromise(() => {
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
  const promise = createLazyPromise<string>((resolve) => {
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
  jest.runAllTimers();
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
  const promise = createLazyPromise<string, string>((resolve, reject) => {
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
      log("handleError", error);
    },
    () => {
      log("handleFailure");
    },
  );
  jest.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "1000 ms passed",
      [
        "handleError",
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
  const promise = createLazyPromise<string, never>((resolve, reject, fail) => {
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
  jest.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "1000 ms passed",
      [
        "handleFailure 1",
        "error",
      ],
      [
        "handleFailure 2",
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
  const promise = createLazyPromise<unknown, string>((resolve, reject) => {
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
  jest.runAllTimers();
  expect(processMockMicrotaskQueue).toThrow("oops");
  // Only one error is thrown.
  processMockMicrotaskQueue();
  // @ts-expect-error
  promise.subscribe();
  expect(processMockMicrotaskQueue).toThrow("oops");
});

test("unhandled failure", () => {
  const promise = createLazyPromise<unknown, string>(
    (resolve, reject, fail) => {
      setTimeout(() => {
        fail("oops");
      }, 1000);
    },
  );
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
  jest.runAllTimers();
  expect(processMockMicrotaskQueue).toThrow("oops");
  // Only one error is thrown.
  processMockMicrotaskQueue();
  // @ts-expect-error
  promise.subscribe();
  expect(processMockMicrotaskQueue).toThrow("oops");
});

test("already resolved", () => {
  const promise = createLazyPromise<number, number>((resolve, reject, fail) => {
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
  const promise = createLazyPromise<number, number>((resolve, reject, fail) => {
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
  const promise = createLazyPromise<number, number>((resolve, reject, fail) => {
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
  const promise = createLazyPromise<number, number>((resolve, reject, fail) => {
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
      log("handleError 1", error);
    },
    (error) => {
      log("handleFailure 1", error);
    },
  )();
  jest.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "produce",
      ],
      [
        "resolve error",
        [Error: You cannot resolve a lazy promise that no longer has any subscribers. Make sure that the callback you're passing to createLazyPromise returns a working teardown function.],
      ],
      [
        "reject error",
        [Error: You cannot reject a lazy promise that no longer has any subscribers. Make sure that the callback you're passing to createLazyPromise returns a working teardown function.],
      ],
      [
        "fail error",
        [Error: You cannot fail a lazy promise that no longer has any subscribers. Make sure that the callback you're passing to createLazyPromise returns a working teardown function.],
      ],
    ]
  `);
});

test("subscribe in teardown function", () => {
  const promise = createLazyPromise(() => () => {
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

test("resolved", () => {
  const promise = resolved(1);
  expect(isLazyPromise(promise)).toMatchInlineSnapshot(`true`);
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
});

test("rejected", () => {
  const promise = rejected("error");
  expect(isLazyPromise(promise)).toMatchInlineSnapshot(`true`);
  expect(
    promise.subscribe(undefined, (error) => {
      log("handleError", error);
    }),
  ).toBe(noopUnsubscribe);
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
  })();
  expect(processMockMicrotaskQueue).toThrow("oops");
  // @ts-expect-error
  const dispose = promise.subscribe();
  dispose();
  expect(processMockMicrotaskQueue).toThrow("error");
});

test("failed", () => {
  const promise = failed("error");
  expect(isLazyPromise(promise)).toMatchInlineSnapshot(`true`);
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
  expect(isLazyPromise(never)).toMatchInlineSnapshot(`true`);
  expect(
    never.subscribe(
      () => {
        log("handleValue");
      },
      () => {
        log("handleError");
      },
      () => {
        log("handleFailure");
      },
    ),
  ).toBe(noopUnsubscribe);
  expect(readLog()).toMatchInlineSnapshot(`[]`);
});

test("isLazyPromise", () => {
  expect(isLazyPromise(undefined)).toMatchInlineSnapshot(`false`);
  expect(isLazyPromise(null)).toMatchInlineSnapshot(`false`);
  expect(isLazyPromise(() => {})).toMatchInlineSnapshot(`false`);
  expect(isLazyPromise(createLazyPromise(() => {}))).toMatchInlineSnapshot(
    `true`,
  );
});
