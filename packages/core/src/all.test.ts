import { afterEach, beforeEach, expect, jest, test } from "@jest/globals";
import { all } from "./all";
import { createLazyPromise, rejected, resolved } from "./lazyPromise";

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

beforeEach(() => {
  jest.useFakeTimers();
  logTime = Date.now();
});

afterEach(() => {
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

  // $ExpectType LazyPromise<[], never>
  const promise1 = all([]);

  // $ExpectType LazyPromise<["value a", "value b"], "error a" | "error b">
  const promise2 = all([
    createLazyPromise<"value a", "error a">(() => {}),
    createLazyPromise<"value b", "error b">(() => {}),
  ]);

  // $ExpectType LazyPromise<never, "error a">
  const promise3 = all([
    createLazyPromise<"value a", "error a">(() => {}),
    createLazyPromise<never, never>(() => {}),
  ]);

  // $ExpectType LazyPromise<"value a"[], "error a">
  const promise4 = all(
    new Set([createLazyPromise<"value a", "error a">(() => {})]),
  );

  /* eslint-enable @typescript-eslint/no-unused-vars */
});

test("empty iterable", () => {
  const promise = all([]);
  promise.subscribe((value) => {
    log("resolve", value);
  });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "resolve",
        [],
      ],
    ]
  `);
});

test("sync resolve", () => {
  const promise = all([resolved("a" as const), resolved("b" as const)]);
  promise.subscribe((value) => {
    log("resolve", value);
  });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "resolve",
        [
          "a",
          "b",
        ],
      ],
    ]
  `);
});

test("non-array iterable", () => {
  const promise = all(new Set([resolved("a")]));
  promise.subscribe(
    (value) => {
      log("resolve", value);
    },
    (error) => {
      log("reject", error);
    },
  );
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "resolve",
        [
          "a",
        ],
      ],
    ]
  `);
});

test("async resolve", () => {
  const promise = all([
    createLazyPromise<"a">((resolve) => {
      setTimeout(() => {
        resolve("a");
      }, 2000);
    }),
    createLazyPromise<"b">((resolve) => {
      setTimeout(() => {
        resolve("b");
      }, 1000);
    }),
    resolved("c" as const),
  ]);
  promise.subscribe((value) => {
    log("resolve", value);
  });
  jest.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "2000 ms passed",
      [
        "resolve",
        [
          "a",
          "b",
          "c",
        ],
      ],
    ]
  `);
});

test("sync error", () => {
  const promise = all([
    createLazyPromise<string>((resolve) => {
      log("produce a");
      setTimeout(() => {
        resolve("a");
      }, 1000);
      return () => {
        log("dispose a");
      };
    }),
    rejected("b"),
    createLazyPromise<string>((resolve) => {
      log("produce c");
      setTimeout(() => {
        resolve("c");
      }, 1000);
      return () => {
        log("dispose c");
      };
    }),
  ]);
  promise.subscribe(
    (value) => {
      log("resolve", value);
    },
    (error) => {
      log("reject", error);
    },
  );
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "produce a",
      ],
      [
        "reject",
        "b",
      ],
      [
        "dispose a",
      ],
    ]
  `);
});

test("async error", () => {
  const promise = all([
    createLazyPromise<string>((resolve) => {
      log("produce a");
      const timeoutId = setTimeout(() => {
        resolve("a");
      }, 1000);
      return () => {
        log("dispose a");
        clearTimeout(timeoutId);
      };
    }),
    createLazyPromise<never, "b">((_, reject) => {
      const timeoutId = setTimeout(() => {
        reject("b");
      }, 2000);
      return () => {
        log("dispose b");
        clearTimeout(timeoutId);
      };
    }),
    createLazyPromise<string>((resolve) => {
      log("produce c");
      const timeoutId = setTimeout(() => {
        resolve("c");
      }, 3000);
      return () => {
        log("dispose c");
        clearTimeout(timeoutId);
      };
    }),
  ]);
  promise.subscribe(
    (value) => {
      log("resolve", value);
    },
    (error) => {
      log("reject", error);
    },
  );
  jest.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "produce a",
      ],
      [
        "produce c",
      ],
      "2000 ms passed",
      [
        "reject",
        "b",
      ],
      [
        "dispose c",
      ],
    ]
  `);
});

test("unsubscribe", () => {
  const promise = all([
    createLazyPromise<"a">((resolve) => {
      log("produce a");
      const timeoutId = setTimeout(() => {
        resolve("a");
      }, 2000);
      return () => {
        log("dispose a");
        clearTimeout(timeoutId);
      };
    }),
    resolved("b" as const),
  ]);
  const dispose = promise.subscribe((value) => {
    log("resolve", value);
  });
  jest.advanceTimersByTime(1000);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "produce a",
      ],
    ]
  `);
  dispose();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "1000 ms passed",
      [
        "dispose a",
      ],
    ]
  `);
});

test("resolve inside a reject consumer", () => {
  let resolveA: (value: "a") => void;
  const promise = all([
    createLazyPromise<"a">((resolve) => {
      log("produce a");
      resolveA = resolve;
      return () => {
        log("dispose a");
      };
    }),
    createLazyPromise<never, "b">((_, reject) => {
      const timeoutId = setTimeout(() => {
        log("reject b");
        reject("b");
      }, 1000);
      return () => {
        log("dispose b");
        clearTimeout(timeoutId);
      };
    }),
  ]);
  promise.subscribe(undefined, () => {
    log("resolve a");
    resolveA("a");
  });
  jest.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "produce a",
      ],
      "1000 ms passed",
      [
        "reject b",
      ],
      [
        "resolve a",
      ],
    ]
  `);
});

test("reject inside a reject consumer", () => {
  let rejectA: (error: "a") => void;
  const promise = all([
    createLazyPromise<never, "a">((_, reject) => {
      log("produce a");
      rejectA = reject;
      return () => {
        log("dispose a");
      };
    }),
    createLazyPromise<never, "b">((_, reject) => {
      const timeoutId = setTimeout(() => {
        log("reject b");
        reject("b");
      }, 1000);
      return () => {
        log("dispose b");
        clearTimeout(timeoutId);
      };
    }),
  ]);
  promise.subscribe(undefined, () => {
    log("reject a");
    rejectA("a");
  });
  jest.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "produce a",
      ],
      "1000 ms passed",
      [
        "reject b",
      ],
      [
        "reject a",
      ],
    ]
  `);
});

test("resolve inside a teardown function", () => {
  let resolveA: ((value: "a") => void) | undefined;
  let resolveB: ((value: "b") => void) | undefined;
  const promise = all([
    createLazyPromise<"a">((resolve) => {
      log("produce a");
      resolveA = resolve;
      return () => {
        resolveA = undefined;
        log("dispose a");
        resolveB?.("b");
      };
    }),
    createLazyPromise<"b">((resolve) => {
      log("produce b");
      resolveB = resolve;
      return () => {
        resolveB = undefined;
        log("dispose b");
        resolveA?.("a");
      };
    }),
  ]);
  promise.subscribe(
    (value) => {
      log("value", value);
    },
    (error) => {
      log("error", error);
    },
  )();
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

test("reject inside a teardown function", () => {
  let rejectA: ((error: "a") => void) | undefined;
  let rejectB: ((error: "b") => void) | undefined;
  const promise = all([
    createLazyPromise<never, "a">((_, reject) => {
      log("produce a");
      rejectA = reject;
      return () => {
        rejectA = undefined;
        log("dispose a");
        rejectB?.("b");
      };
    }),
    createLazyPromise<never, "b">((_, reject) => {
      log("produce b");
      rejectB = reject;
      return () => {
        rejectB = undefined;
        log("dispose b");
        rejectA?.("a");
      };
    }),
  ]);
  promise.subscribe(
    (value) => {
      log("value", value);
    },
    (error) => {
      log("error", error);
    },
  )();
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

test("reject a source in producer of another source", () => {
  let rejectA: ((error: "a") => void) | undefined;
  const promise = all([
    createLazyPromise<never, "a">((_, reject) => {
      log("produce a");
      rejectA = reject;
      return () => {
        log("dispose a");
      };
    }),
    createLazyPromise<never>(() => {
      log("produce b");
      rejectA?.("a");
      return () => {
        log("dispose b");
      };
    }),
  ]);
  promise.subscribe(
    (value) => {
      log("resolve", value);
    },
    (error) => {
      log("reject", error);
    },
  );
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "produce a",
      ],
      [
        "produce b",
      ],
      [
        "reject",
        "a",
      ],
      [
        "dispose b",
      ],
    ]
  `);
});
