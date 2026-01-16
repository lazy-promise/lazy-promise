import {
  failed,
  finalize,
  LazyPromise,
  pipe,
  rejected,
  resolved,
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

test("source resolves", () => {
  const promise = pipe(
    resolved(1),
    finalize(() => {
      log("finalize");
    }),
  );
  promise.subscribe((value) => {
    log("handleValue", value);
  });
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
  const promise = pipe(
    rejected(1),
    finalize(() => {
      log("finalize");
    }),
  );
  promise.subscribe(undefined, (error) => {
    log("handleError", error);
  });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "finalize",
      ],
      [
        "handleError",
        1,
      ],
    ]
  `);
});

test("source fails", () => {
  const promise = pipe(
    new LazyPromise((resolve, reject, fail) => {
      fail("oops");
    }),
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
  pipe(
    resolved(1),
    finalize(() => {
      throw "oops 1";
    }),
  ).subscribe(undefined, undefined, (error) => {
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

  pipe(
    rejected(1),
    finalize(() => {
      throw "oops 2";
    }),
  ).subscribe(
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

  pipe(
    new LazyPromise((resolve, reject, fail) => {
      fail("oops 1");
    }),
    finalize(() => {
      throw "oops 2";
    }),
  ).subscribe(undefined, undefined, (error) => {
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
  const unsubscribe = pipe(
    new LazyPromise((resolveLocal) => {
      resolve = resolveLocal;
    }),
    finalize(() => {
      unsubscribe();
    }),
  ).subscribe(() => {
    log("handleValue");
  });
  resolve!(1);
  expect(readLog()).toMatchInlineSnapshot(`[]`);
});

test("unsubscribe in the callback (source rejects)", () => {
  let reject: (value: number) => void;
  const unsubscribe = pipe(
    new LazyPromise<never, number>((resolve, rejectLocal) => {
      reject = rejectLocal;
    }),
    finalize(() => {
      unsubscribe();
    }),
  ).subscribe(
    () => {
      log("handleValue");
    },
    () => {
      log("handleError");
    },
  );
  reject!(1);
  expect(readLog()).toMatchInlineSnapshot(`[]`);
});

test("unsubscribe in the callback (source fails)", () => {
  let fail: (error: unknown) => void;
  const unsubscribe = pipe(
    new LazyPromise<never, number>((resolve, reject, failLocal) => {
      fail = failLocal;
    }),
    finalize(() => {
      unsubscribe();
    }),
  ).subscribe(
    () => {
      log("handleValue");
    },
    () => {
      log("handleError");
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
  const unsubscribe = pipe(
    new LazyPromise((resolveLocal) => {
      resolve = resolveLocal;
    }),
    finalize(() => {
      unsubscribe();
      throw "oops";
    }),
  ).subscribe(
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
  const unsubscribe = pipe(
    new LazyPromise<never, number>((resolve, rejectLocal) => {
      reject = rejectLocal;
    }),
    finalize(() => {
      unsubscribe();
      throw "oops";
    }),
  ).subscribe(
    () => {
      log("handleValue");
    },
    () => {
      log("handleError");
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
  const unsubscribe = pipe(
    new LazyPromise((resolve, reject, failLocal) => {
      fail = failLocal;
    }),
    finalize(() => {
      unsubscribe();
      throw "oops";
    }),
  ).subscribe(
    () => {
      log("handleValue");
    },
    () => {
      log("handleError");
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
  const promise = pipe(
    resolved(1),
    finalize(
      () =>
        new LazyPromise<2>((resolve) => {
          setTimeout(() => {
            resolve(2);
          }, 1000);
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
  const promise = pipe(
    resolved(1),
    finalize(() => rejected(2) as LazyPromise<never, never>),
  );
  promise.subscribe(
    (value) => {
      log("handleValue", value);
    },
    (error) => {
      log("handleError", error);
    },
    (error) => {
      log("handleFailure");
      if (!(error instanceof Error)) {
        throw new Error("fail");
      }
      expect(error.message).toMatchInlineSnapshot(
        `"The lazy promise returned by finalize(...) callback has rejected. The original error has been stored as the .cause property."`,
      );
      expect(error.cause).toMatchInlineSnapshot(`2`);
    },
  );
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleFailure",
      ],
    ]
  `);
});

test("inner promise fails", () => {
  const promise = pipe(
    failed(1),
    finalize(() => failed(2)),
  );
  promise.subscribe(
    (value) => {
      log("handleValue", value);
    },
    (error) => {
      log("handleError", error);
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
  const promise = pipe(
    new LazyPromise(() => () => {
      log("dispose");
    }),
    finalize(() => undefined),
  );
  const dispose = promise.subscribe();
  vi.advanceTimersByTime(500);
  expect(readLog()).toMatchInlineSnapshot(`[]`);
  dispose();
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
  const promise = pipe(
    resolved(1),
    finalize(
      () =>
        new LazyPromise(() => () => {
          log("dispose");
        }),
    ),
  );
  const dispose = promise.subscribe();
  vi.advanceTimersByTime(500);
  expect(readLog()).toMatchInlineSnapshot(`[]`);
  dispose();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "500 ms passed",
      [
        "dispose",
      ],
    ]
  `);
});
