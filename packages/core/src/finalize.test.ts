import {
  box,
  finalize,
  LazyPromise,
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
  expectTypeOf(box(1).pipe(finalize(() => {}))).toEqualTypeOf<LazyPromise<1>>();

  expectTypeOf(box(1).pipe(finalize(() => box(2)))).toEqualTypeOf<
    LazyPromise<1>
  >();

  expectTypeOf(box(new TypedError(1)).pipe(finalize(() => {}))).toEqualTypeOf<
    LazyPromise<TypedError<1>>
  >();

  expectTypeOf(
    box(new TypedError(1)).pipe(finalize(() => new TypedError(2))),
  ).toEqualTypeOf<LazyPromise<TypedError<1> | TypedError<2>>>();

  expectTypeOf(
    box(new TypedError(1)).pipe(finalize(() => box(new TypedError(2)))),
  ).toEqualTypeOf<LazyPromise<TypedError<1> | TypedError<2>>>();
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

test("callback returns a typed error", () => {
  const promise = box(1).pipe(finalize(() => new TypedError(1)));
  const unsubscribe = promise.subscribe((value) => {
    log("handleValue", value);
  });
  expect(unsubscribe).toMatchInlineSnapshot(`undefined`);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleValue",
        TypedError {
          "error": 1,
        },
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
    .subscribe(undefined, (error) => {
      log("handleError", error);
    });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleError",
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
    .subscribe(undefined, (error) => {
      log("handleError", error);
    });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleError",
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
  const unsubscribe = new LazyPromise<TypedError<number>>(
    (resolve, rejectLocal) => {
      reject = rejectLocal;
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
        log("handleError");
      },
    );
  reject!(1);
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
      () => {
        log("handleError");
      },
    );
  resolve!(1);
});

test("unsubscribe and throw in the callback (source rejects)", () => {
  let reject: (error: number) => void;
  const unsubscribe = new LazyPromise<never>((resolve, rejectLocal) => {
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
        log("handleError");
      },
    );
  reject!(1);
  expect(readLog()).toMatchInlineSnapshot(`[]`);
});

test("inner promise resolves (source resolves)", () => {
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

test("inner promise resolves (source rejects)", () => {
  const promise = rejected(1).pipe(
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
  promise.subscribe(
    (value) => {
      log("handleValue", value);
    },
    (error) => {
      log("handleError", error);
    },
  );
  expect(readLog()).toMatchInlineSnapshot(`[]`);
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
});

test("inner promise resolves with a typed error (source resolves)", () => {
  const promise = box(new TypedError(1)).pipe(
    finalize(() => box(new TypedError(2))),
  );
  promise.subscribe(
    (value) => {
      log("handleValue", value);
    },
    (error) => {
      log("handleError", error);
    },
  );
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleValue",
        TypedError {
          "error": 2,
        },
      ],
    ]
  `);
});

test("inner promise resolves with a typed error (source rejects)", () => {
  const promise = rejected(1).pipe(finalize(() => box(new TypedError(2))));
  promise.subscribe(
    (value) => {
      log("handleValue", value);
    },
    (error) => {
      log("handleError", error);
    },
  );
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleValue",
        TypedError {
          "error": 2,
        },
      ],
    ]
  `);
});

test("inner promise rejects", () => {
  const promise = rejected(1).pipe(finalize(() => rejected(2)));
  promise.subscribe(
    (value) => {
      log("handleValue", value);
    },
    (error) => {
      log("handleError", error);
    },
  );
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleError",
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
