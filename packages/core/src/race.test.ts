import { afterEach, beforeEach, expect, jest, test } from "@jest/globals";
import { createLazyPromise, rejected, resolved } from "./lazyPromise";
import { race } from "./race";

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

test("empty iterable", () => {
  const promise = race([]);
  promise.subscribe(
    (value) => {
      log("resolve", value);
    },
    (error) => {
      log("reject", error);
    },
  );
  expect(readLog()).toMatchInlineSnapshot(`[]`);
});

test("sync resolve", () => {
  const promise = race([
    createLazyPromise<never>(() => () => {
      log("dispose a");
    }),
    resolved("b" as const),
  ]);
  promise.subscribe((value) => {
    log("resolve", value);
  });
  expect(readLog()).toMatchInlineSnapshot(`
    [
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

test("non-array iterable", () => {
  const promise = race(new Set([resolved("a")]));
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

test("async resolve", () => {
  const promise = race([
    createLazyPromise<"a">((resolve) => {
      const timeoutId = setTimeout(() => {
        resolve("a");
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
  ]);
  promise.subscribe((value) => {
    log("resolve", value);
  });
  jest.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "1000 ms passed",
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

test("sync error", () => {
  const promise = race([
    createLazyPromise<never>(() => () => {
      log("dispose a");
    }),
    rejected("b" as const),
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
  const promise = race([
    createLazyPromise<never, "a">((_, reject) => {
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
      "1000 ms passed",
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

test("unsubscribe", () => {
  const promise = race([
    createLazyPromise<never>(() => {
      log("produce a");
      return () => {
        log("dispose a");
      };
    }),
    createLazyPromise<never>(() => {
      log("produce b");
      return () => {
        log("dispose b");
      };
    }),
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
      [
        "produce b",
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
      [
        "dispose b",
      ],
    ]
  `);
});

test("resolve inside a reject consumer", () => {
  let resolveA: (value: "a") => void;
  const promise = race([
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
  const promise = race([
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
  const promise = race([
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
  const promise = race([
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

test("resolve a source in producer of another source", () => {
  let resolveA: ((value: "a") => void) | undefined;
  const promise = race([
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

test("reject a source in producer of another source", () => {
  let rejectA: ((error: "a") => void) | undefined;
  const promise = race([
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
