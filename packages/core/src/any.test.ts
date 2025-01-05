import { afterEach, beforeEach, expect, jest, test } from "@jest/globals";
import { any } from "./any";
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

  // $ExpectType LazyPromise<never, []>
  const promise1 = any([]);

  // $ExpectType LazyPromise<"value a" | "value b", ["error a", "error b"]>
  const promise2 = any([
    createLazyPromise<"value a", "error a">(() => {}),
    createLazyPromise<"value b", "error b">(() => {}),
  ]);

  // $ExpectType LazyPromise<"value a", never>
  const promise3 = any([
    createLazyPromise<"value a", "error a">(() => {}),
    createLazyPromise<never, never>(() => {}),
  ]);

  // $ExpectType LazyPromise<"value a", "error a"[]>
  const promise4 = any(
    new Set([createLazyPromise<"value a", "error a">(() => {})]),
  );

  /* eslint-enable @typescript-eslint/no-unused-vars */
});

test("empty iterable", () => {
  const promise = any([]);
  promise.subscribe(undefined, (error) => {
    log("reject", error);
  });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "reject",
        [],
      ],
    ]
  `);
});

test("sync reject", () => {
  const promise = any([rejected("a" as const), rejected("b" as const)]);
  promise.subscribe(undefined, (error) => {
    log("reject", error);
  });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "reject",
        [
          "a",
          "b",
        ],
      ],
    ]
  `);
});

test("non-array iterable", () => {
  const promise = any(new Set([resolved("a")]));
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
        "a",
      ],
    ]
  `);
});

test("async reject", () => {
  const promise = any([
    createLazyPromise<never, "a">((_, reject) => {
      setTimeout(() => {
        reject("a");
      }, 2000);
    }),
    createLazyPromise<never, "b">((_, reject) => {
      setTimeout(() => {
        reject("b");
      }, 1000);
    }),
    rejected("c" as const),
  ]);
  promise.subscribe(undefined, (error) => {
    log("reject", error);
  });
  jest.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "2000 ms passed",
      [
        "reject",
        [
          "a",
          "b",
          "c",
        ],
      ],
    ]
  `);
});

test("sync resolve", () => {
  const promise = any([
    createLazyPromise<never, string>((_, reject) => {
      log("produce a");
      setTimeout(() => {
        reject("a");
      }, 1000);
      return () => {
        log("dispose a");
      };
    }),
    resolved("b"),
    createLazyPromise<never, string>((_, reject) => {
      log("produce c");
      setTimeout(() => {
        reject("c");
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
        "resolve",
        "b",
      ],
      [
        "dispose a",
      ],
    ]
  `);
});

test("async resolve", () => {
  const promise = any([
    createLazyPromise<never, string>((_, reject) => {
      log("produce a");
      const timeoutId = setTimeout(() => {
        reject("a");
      }, 1000);
      return () => {
        log("dispose a");
        clearTimeout(timeoutId);
      };
    }),
    createLazyPromise<"b">((resolve) => {
      const timeoutId = setTimeout(() => {
        resolve("b");
      }, 2000);
      return () => {
        log("dispose b");
        clearTimeout(timeoutId);
      };
    }),
    createLazyPromise<never, string>((_, reject) => {
      log("produce c");
      const timeoutId = setTimeout(() => {
        reject("c");
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
        "resolve",
        "b",
      ],
      [
        "dispose c",
      ],
    ]
  `);
});

test("unsubscribe", () => {
  const promise = any([
    createLazyPromise<never, "a">((_, reject) => {
      log("produce a");
      const timeoutId = setTimeout(() => {
        reject("a");
      }, 2000);
      return () => {
        log("dispose a");
        clearTimeout(timeoutId);
      };
    }),
    rejected("b" as const),
  ]);
  const dispose = promise.subscribe(undefined, (error) => {
    log("reject", error);
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

test("reject inside a resolve consumer", () => {
  let rejectA: (error: "a") => void;
  const promise = any([
    createLazyPromise<never, "a">((_, reject) => {
      log("produce a");
      rejectA = reject;
      return () => {
        log("dispose a");
      };
    }),
    createLazyPromise<"b">((resolve) => {
      const timeoutId = setTimeout(() => {
        log("resolve b");
        resolve("b");
      }, 1000);
      return () => {
        log("dispose b");
        clearTimeout(timeoutId);
      };
    }),
  ]);
  promise.subscribe(() => {
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
        "resolve b",
      ],
      [
        "reject a",
      ],
    ]
  `);
});

test("resolve inside a resolve consumer", () => {
  let resolveA: (value: "a") => void;
  const promise = any([
    createLazyPromise<"a">((resolve) => {
      log("produce a");
      resolveA = resolve;
      return () => {
        log("dispose a");
      };
    }),
    createLazyPromise<"b">((resolve) => {
      const timeoutId = setTimeout(() => {
        log("resolve b");
        resolve("b");
      }, 1000);
      return () => {
        log("dispose b");
        clearTimeout(timeoutId);
      };
    }),
  ]);
  promise.subscribe(() => {
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
        "resolve b",
      ],
      [
        "resolve a",
      ],
    ]
  `);
});

test("reject inside a teardown function", () => {
  let rejectA: ((error: "a") => void) | undefined;
  let rejectB: ((error: "b") => void) | undefined;
  const promise = any([
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

test("resolve inside a teardown function", () => {
  let resolveA: ((value: "a") => void) | undefined;
  let resolveB: ((value: "b") => void) | undefined;
  const promise = any([
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

test("resolve a source in producer of another source", () => {
  let resolveA: ((value: "a") => void) | undefined;
  const promise = any([
    createLazyPromise<"a">((resolve) => {
      log("produce a");
      resolveA = resolve;
      return () => {
        log("dispose a");
      };
    }),
    createLazyPromise<never>(() => {
      log("produce b");
      resolveA?.("a");
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
        "resolve",
        "a",
      ],
      [
        "dispose b",
      ],
    ]
  `);
});
