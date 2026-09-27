import type { Consumer, Sink } from "@lazy-promise/core";
import { box, ErrorBox, LazyPromise, rejecting } from "@lazy-promise/core";
import { afterEach, beforeEach, expect, expectTypeOf, test, vi } from "vitest";

const unhandledErrors: unknown[] = [];
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

const logConsumer: Consumer<any> = {
  resolve: (value) => {
    log("handleValue", value);
  },
  reject: (error) => {
    log("handleError", error);
  },
};

const readUnhandledErrors = () => {
  try {
    return [...unhandledErrors];
  } finally {
    unhandledErrors.length = 0;
  }
};

beforeEach(() => {
  vi.useFakeTimers();
  logTime = Date.now();
  vi.spyOn(Promise, "reject").mockImplementation((error) => {
    unhandledErrors.push(error);
    return new Promise<never>(() => {});
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  try {
    if (unhandledErrors.length) {
      throw new Error("Unhandled errors expected to be read by each test.");
    }
    if (logContents.length) {
      throw new Error("Log expected to be empty at the end of each test.");
    }
  } finally {
    unhandledErrors.length = 0;
    logContents.length = 0;
  }
});

test("types", () => {
  expectTypeOf(box(1).finally(() => {})).toEqualTypeOf<LazyPromise<1>>();

  expectTypeOf(box(1).finally(() => box(2))).toEqualTypeOf<LazyPromise<1>>();

  expectTypeOf(box(new ErrorBox(1)).finally(() => {})).toEqualTypeOf<
    LazyPromise<ErrorBox<1>>
  >();

  expectTypeOf(
    box(new ErrorBox(1)).finally(() => new ErrorBox(2)),
  ).toEqualTypeOf<LazyPromise<ErrorBox<1> | ErrorBox<2>>>();

  expectTypeOf(
    box(new ErrorBox(1)).finally(() => box(new ErrorBox(2))),
  ).toEqualTypeOf<LazyPromise<ErrorBox<1> | ErrorBox<2>>>();

  expectTypeOf(
    box(1).finally(() => {
      throw "oops";
    }),
  ).toEqualTypeOf<LazyPromise<1>>();

  expectTypeOf(
    new LazyPromise<void, { outer: null }>(() => {}).finally(
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      (dep: { callback: null }) =>
        new LazyPromise<void, { inner: null }>(() => {}),
    ),
  ).toEqualTypeOf<
    LazyPromise<void, { outer: null } & { inner: null } & { callback: null }>
  >();
});

test("value of this", () => {
  const promise = box(1).finally(function () {
    /** @ts-expect-error */
    log("in callback", this);
  });
  promise.subscribe();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "in callback",
        undefined,
      ],
    ]
  `);
});

test("source resolves", () => {
  const promise = box(1).finally(() => {
    log("finally");
  });
  promise.subscribe(logConsumer);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "finally",
      ],
      [
        "handleValue",
        1,
      ],
    ]
  `);
});

test("source rejects", () => {
  const promise = rejecting(1).finally(() => {
    log("finally");
  });
  promise.subscribe(logConsumer);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "finally",
      ],
      [
        "handleError",
        1,
      ],
    ]
  `);
});

test("callback returns a boxed error", () => {
  const promise = box(1).finally(() => new ErrorBox(1));
  promise.subscribe<unknown>(logConsumer);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleValue",
        ErrorBox {
          "error": 1,
        },
      ],
    ]
  `);
});

test("callback throws", () => {
  box(1)
    .finally(() => {
      throw "oops 1";
    })
    .subscribe(logConsumer);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleError",
        "oops 1",
      ],
    ]
  `);

  rejecting(1)
    .finally(() => {
      throw "oops 2";
    })
    .subscribe(logConsumer);
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
  let sink: Sink<number>;
  const subscription = new LazyPromise<number>((sinkLocal) => {
    sink = sinkLocal;
  })
    .finally(() => {
      subscription.dispose();
    })
    .subscribe(logConsumer);
  sink!.resolve(1);
  expect(readLog()).toMatchInlineSnapshot(`[]`);
});

test("unsubscribe in the callback (source rejects)", () => {
  let sink: Sink<never>;
  const subscription = new LazyPromise<never>((sinkLocal) => {
    sink = sinkLocal;
  })
    .finally(() => {
      subscription.dispose();
    })
    .subscribe(logConsumer);
  sink!.reject(1);
  expect(readLog()).toMatchInlineSnapshot(`[]`);
});

test("unsubscribe and throw in the callback (source resolves)", () => {
  let sink: Sink<number>;
  const subscription = new LazyPromise<number>((sinkLocal) => {
    sink = sinkLocal;
  })
    .finally(() => {
      subscription.dispose();
      throw "oops";
    })
    .subscribe(logConsumer);
  sink!.resolve(1);
});

test("unsubscribe and throw in the callback (source rejects)", () => {
  let sink: Sink<never>;
  const subscription = new LazyPromise<never>((sinkLocal) => {
    sink = sinkLocal;
  })
    .finally(() => {
      subscription.dispose();
      throw "oops";
    })
    .subscribe(logConsumer);
  sink!.reject(1);
  expect(readLog()).toMatchInlineSnapshot(`[]`);
});

test("dependency injection", () => {
  new LazyPromise<void, "dep">((sink, dep) => {
    log("outer promise dep", dep);
    sink.resolve();
  })
    .finally((dep: "dep") => {
      log("callback dep", dep);
      return new LazyPromise<void, "dep">((sink, dep) => {
        log("inner promise dep", dep);
      });
    })
    .subscribe(undefined, "dep");

  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "outer promise dep",
        "dep",
      ],
      [
        "callback dep",
        "dep",
      ],
      [
        "inner promise dep",
        "dep",
      ],
    ]
  `);
});

test("inner promise resolves (source resolves)", () => {
  const promise = box(1).finally(
    () =>
      new LazyPromise<2>((sink) => {
        setTimeout(() => {
          sink.resolve(2);
        }, 1000);
      }),
  );
  promise.subscribe(logConsumer);
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
  const promise = rejecting(1).finally(
    () =>
      new LazyPromise<2>((sink) => {
        setTimeout(() => {
          sink.resolve(2);
        }, 1000);
      }),
  );
  promise.subscribe(logConsumer);
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

test("inner promise resolves with a boxed error (source resolves)", () => {
  const promise = box(new ErrorBox(1)).finally(() => box(new ErrorBox(2)));
  promise.subscribe<unknown>(logConsumer);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleValue",
        ErrorBox {
          "error": 2,
        },
      ],
    ]
  `);
});

test("inner promise resolves with a boxed error (source rejects)", () => {
  const promise = rejecting(1).finally(() => box(new ErrorBox(2)));
  promise.subscribe<unknown>(logConsumer);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleValue",
        ErrorBox {
          "error": 2,
        },
      ],
    ]
  `);
});

test("inner promise rejects", () => {
  const promise = rejecting(1).finally(() => rejecting(2));
  promise.subscribe(logConsumer);
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
  const promise = new LazyPromise<never, "dep">(() => () => {
    log("dispose");
  }).finally((dep: "dep") => {
    log("callback", dep);
  });
  const subscription = promise.subscribe(logConsumer, "dep");
  vi.advanceTimersByTime(500);
  expect(readLog()).toMatchInlineSnapshot(`[]`);
  subscription.dispose();
  subscription.dispose();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "500 ms passed",
      [
        "dispose",
      ],
      [
        "callback",
        "dep",
      ],
    ]
  `);
});

test("cancel outer promise (callback returns a promise)", () => {
  const promise = new LazyPromise<never>(() => {}).finally(
    () =>
      new LazyPromise<void, "dep">((sink, dep) => {
        log("inner produce", dep);
        const timeoutId = setTimeout(() => {
          sink.resolve();
        }, 1000);
        return () => {
          log("inner dispose");
          clearTimeout(timeoutId);
        };
      }),
  );
  promise.subscribe(logConsumer, "dep").dispose();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "inner produce",
        "dep",
      ],
    ]
  `);
  vi.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "1000 ms passed",
      [
        "inner dispose",
      ],
    ]
  `);
});

test("cancel outer promise (callback throws)", () => {
  new LazyPromise<never>(() => {})
    .finally(() => {
      throw "oops";
    })
    .subscribe(logConsumer)
    .dispose();
  expect(readUnhandledErrors()).toEqual(["oops"]);
});

test("cancel outer promise (callback returns a rejecting promise)", () => {
  new LazyPromise<never>(() => {})
    .finally(() => rejecting("oops"))
    .subscribe(logConsumer)
    .dispose();
  expect(readUnhandledErrors()).toEqual(["oops"]);
});

test("cancel outer promise (callback returns a boxed error)", () => {
  new LazyPromise<never>(() => {})
    .finally(() => new ErrorBox("oops"))
    .subscribe<unknown>(logConsumer)
    .dispose();
  expect(readLog()).toMatchInlineSnapshot(`[]`);
});

test("cancel outer promise from the source teardown", () => {
  const subscription = new LazyPromise<never>(() => () => {
    log("dispose");
    subscription.dispose();
  })
    .finally(() => {
      log("callback");
    })
    .subscribe(logConsumer);
  subscription.dispose();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "dispose",
      ],
      [
        "callback",
      ],
    ]
  `);
});

test("cancel outer promise from the source producer", () => {
  const subscription = new LazyPromise<never>((sink) => {
    setTimeout(() => {
      sink.resolve(
        new LazyPromise<never>(() => {
          subscription.dispose();
          return () => {
            log("dispose");
          };
        }),
      );
    }, 1000);
  })
    .finally(() => {
      log("callback");
    })
    .subscribe(logConsumer);
  vi.runAllTimers();
  // The teardown of a producer that is still running has to wait for it.
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "1000 ms passed",
      [
        "callback",
      ],
      [
        "dispose",
      ],
    ]
  `);
});

test("cancel inner promise", () => {
  const promise = box(1).finally(() => {
    log("callback");
    return new LazyPromise(() => () => {
      log("dispose");
    });
  });
  const subscription = promise.subscribe();
  vi.advanceTimersByTime(500);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "callback",
      ],
    ]
  `);
  subscription.dispose();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "500 ms passed",
      [
        "dispose",
      ],
    ]
  `);
});
