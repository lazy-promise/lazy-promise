import {
  box,
  failed,
  finalize,
  LazyPromise,
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

  // $ExpectType LazyPromise<1, never>
  const promise1 = box(1).pipe(finalize(() => {}));

  // $ExpectType LazyPromise<1, never>
  const promise2 = box(1).pipe(finalize(() => box(2)));

  // $ExpectType LazyPromise<never, 1>
  const promise3 = rejected(1).pipe(finalize(() => {}));

  // $ExpectType LazyPromise<never, 2 | 1>
  const promise4 = rejected(1).pipe(finalize(() => rejected(2)));

  /* eslint-enable @typescript-eslint/no-unused-vars */
});

test("source resolves", () => {
  const promise = box(1).pipe(
    finalize(() => {
      log("finalize");
    }),
  );
  const unsubscribe = promise.subscribe((value) => {
    log("handleValue", value);
  });
  expect(unsubscribe).toMatchInlineSnapshot(`undefined`);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "finalize",
      ],
      [
        "handleValue",
        1,
      ],
    ]
  `);
});

test("source rejects", () => {
  const promise = rejected(1).pipe(
    finalize(() => {
      log("finalize");
    }),
  );
  promise.subscribe(undefined, (error) => {
    log("handleRejection", error);
  });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "finalize",
      ],
      [
        "handleRejection",
        1,
      ],
    ]
  `);
});

test("source fails", () => {
  const promise = new LazyPromise((resolve, reject, fail) => {
    fail("oops");
  }).pipe(
    finalize(() => {
      log("finalize");
    }),
  );
  promise.subscribe(undefined, undefined, (error) => {
    log("handleFailure", error);
  });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "finalize",
      ],
      [
        "handleFailure",
        "oops",
      ],
    ]
  `);
});

test("callback throws", () => {
  box(1)
    .pipe(
      finalize(() => {
        throw "oops 1";
      }),
    )
    .subscribe(undefined, undefined, (error) => {
      log("handleFailure", error);
    });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleFailure",
        "oops 1",
      ],
    ]
  `);

  rejected(1)
    .pipe(
      finalize(() => {
        throw "oops 2";
      }),
    )
    .subscribe(
      undefined,
      () => {},
      (error) => {
        log("handleFailure", error);
      },
    );
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleFailure",
        "oops 2",
      ],
    ]
  `);

  new LazyPromise((resolve, reject, fail) => {
    fail("oops 1");
  })
    .pipe(
      finalize(() => {
        throw "oops 2";
      }),
    )
    .subscribe(undefined, undefined, (error) => {
      log("handleFailure", error);
    });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleFailure",
        "oops 2",
      ],
    ]
  `);
});

test("unsubscribe in the callback (source resolves)", () => {
  let resolve: (value: number) => void;
  const unsubscribe = new LazyPromise((resolveLocal) => {
    resolve = resolveLocal;
    return () => {};
  })
    .pipe(
      finalize(() => {
        unsubscribe!();
      }),
    )
    .subscribe(() => {
      log("handleValue");
    });
  resolve!(1);
  expect(readLog()).toMatchInlineSnapshot(`[]`);
});

test("unsubscribe in the callback (source rejects)", () => {
  let reject: (value: number) => void;
  const unsubscribe = new LazyPromise<never, number>((resolve, rejectLocal) => {
    reject = rejectLocal;
    return () => {};
  })
    .pipe(
      finalize(() => {
        unsubscribe!();
      }),
    )
    .subscribe(
      () => {
        log("handleValue");
      },
      () => {
        log("handleRejection");
      },
    );
  reject!(1);
  expect(readLog()).toMatchInlineSnapshot(`[]`);
});

test("unsubscribe in the callback (source fails)", () => {
  let fail: (error: unknown) => void;
  const unsubscribe = new LazyPromise<never, number>(
    (resolve, reject, failLocal) => {
      fail = failLocal;
      return () => {};
    },
  )
    .pipe(
      finalize(() => {
        unsubscribe!();
      }),
    )
    .subscribe(
      () => {
        log("handleValue");
      },
      () => {
        log("handleRejection");
      },
      () => {
        log("handleFailure");
      },
    );
  fail!(1);
  expect(readLog()).toMatchInlineSnapshot(`[]`);
});

test("unsubscribe and throw in the callback (source resolves)", () => {
  let resolve: (value: number) => void;
  const unsubscribe = new LazyPromise((resolveLocal) => {
    resolve = resolveLocal;
    return () => {};
  })
    .pipe(
      finalize(() => {
        unsubscribe!();
        throw "oops";
      }),
    )
    .subscribe(
      () => {
        log("handleValue");
      },
      undefined,
      () => {
        log("handleFailure");
      },
    );
  resolve!(1);
  expect(readLog()).toMatchInlineSnapshot(`[]`);
  expect(processMockMicrotaskQueue).toThrow("oops");
});

test("unsubscribe and throw in the callback (source rejects)", () => {
  let reject: (error: number) => void;
  const unsubscribe = new LazyPromise<never, number>((resolve, rejectLocal) => {
    reject = rejectLocal;
    return () => {};
  })
    .pipe(
      finalize(() => {
        unsubscribe!();
        throw "oops";
      }),
    )
    .subscribe(
      () => {
        log("handleValue");
      },
      () => {
        log("handleRejection");
      },
      () => {
        log("handleFailure");
      },
    );
  reject!(1);
  expect(readLog()).toMatchInlineSnapshot(`[]`);
  expect(processMockMicrotaskQueue).toThrow("oops");
});

test("unsubscribe and throw in the callback (source fails)", () => {
  let fail: (error: unknown) => void;
  const unsubscribe = new LazyPromise((resolve, reject, failLocal) => {
    fail = failLocal;
    return () => {};
  })
    .pipe(
      finalize(() => {
        unsubscribe!();
        throw "oops";
      }),
    )
    .subscribe(
      () => {
        log("handleValue");
      },
      () => {
        log("handleRejection");
      },
      () => {
        log("handleFailure");
      },
    );
  fail!(1);
  expect(readLog()).toMatchInlineSnapshot(`[]`);
  expect(processMockMicrotaskQueue).toThrow("oops");
});

test("inner promise resolves", () => {
  const promise = box(1).pipe(
    finalize(
      () =>
        new LazyPromise<2>((resolve) => {
          setTimeout(() => {
            resolve(2);
          }, 1000);
          return () => {};
        }),
    ),
  );
  promise.subscribe((value) => {
    log("handleValue", value);
  });
  expect(readLog()).toMatchInlineSnapshot(`[]`);
  vi.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "1000 ms passed",
      [
        "handleValue",
        1,
      ],
    ]
  `);
});

test("inner promise rejects", () => {
  const promise = failed(1).pipe(finalize(() => rejected(2)));
  promise.subscribe(
    (value) => {
      log("handleValue", value);
    },
    (error) => {
      log("handleRejection", error);
    },
    (error) => {
      log("handleFailure", error);
    },
  );
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleRejection",
        2,
      ],
    ]
  `);
});

test("inner promise fails", () => {
  const promise = rejected(1).pipe(finalize(() => failed(2)));
  promise.subscribe(
    (value) => {
      log("handleValue", value);
    },
    (error) => {
      log("handleRejection", error);
    },
    (error) => {
      log("handleFailure", error);
    },
  );
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleFailure",
        2,
      ],
    ]
  `);
});

test("cancel outer promise", () => {
  const promise = new LazyPromise(() => () => {
    log("dispose");
  }).pipe(finalize(() => undefined));
  const unsubscribe = promise.subscribe();
  vi.advanceTimersByTime(500);
  expect(readLog()).toMatchInlineSnapshot(`[]`);
  unsubscribe!();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "500 ms passed",
      [
        "dispose",
      ],
    ]
  `);
});

test("cancel inner promise", () => {
  const promise = box(1).pipe(
    finalize(
      () =>
        new LazyPromise(() => () => {
          log("dispose");
        }),
    ),
  );
  const unsubscribe = promise.subscribe();
  vi.advanceTimersByTime(500);
  expect(readLog()).toMatchInlineSnapshot(`[]`);
  unsubscribe!();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "500 ms passed",
      [
        "dispose",
      ],
    ]
  `);
});
