import type { Consumer } from "@lazy-promise/core";
import {
  box,
  ErrorBox,
  fromGen,
  LazyPromise,
  never,
  rejecting,
} from "@lazy-promise/core";
import { afterEach, beforeEach, expect, expectTypeOf, test, vi } from "vitest";

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

beforeEach(() => {
  vi.useFakeTimers();
  logTime = Date.now();
});

afterEach(() => {
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
  const lazyPromise = fromGen(function* () {
    const value = yield* new LazyPromise<"a" | "b" | ErrorBox<"error1">>(
      () => {},
    );
    expectTypeOf(value).toEqualTypeOf<"a" | "b">();
    if (value === "a") {
      return yield* new LazyPromise<ErrorBox<"error2">>(() => {});
    }
    return value;
  });

  expectTypeOf(lazyPromise).toEqualTypeOf<
    LazyPromise<ErrorBox<"error2"> | ErrorBox<"error1"> | "b">
  >();

  const generatorFunction = function* () {
    const value = yield* new LazyPromise<"a" | "b" | ErrorBox<"error1">>(
      () => {},
    );
    expectTypeOf(value).toEqualTypeOf<"a" | "b">();
    if (value === "a") {
      return yield* new LazyPromise<ErrorBox<"error2">>(() => {});
    }
    return value;
  };
  expectTypeOf(fromGen(generatorFunction)).toEqualTypeOf<
    LazyPromise<ErrorBox<"error2"> | ErrorBox<"error1"> | "b">
  >();

  expectTypeOf(
    fromGen(function* () {
      return 1 as const;
    }),
  ).toEqualTypeOf<LazyPromise<1>>();

  expectTypeOf(fromGen(function* () {})).toEqualTypeOf<LazyPromise<void>>();

  expectTypeOf(
    fromGen(function* () {
      if (true as boolean) {
        return new LazyPromise<ErrorBox<"error1">>(() => {});
      }
      return new LazyPromise<"a">(() => {});
    }),
  ).toEqualTypeOf<LazyPromise<"a" | ErrorBox<"error1">>>();

  expectTypeOf(
    fromGen(function* () {
      throw "a";
    }),
  ).toEqualTypeOf<LazyPromise<never>>();

  expectTypeOf(
    fromGen(function* () {
      yield* rejecting(1);
    }),
  ).toEqualTypeOf<LazyPromise<void>>();

  expectTypeOf(
    fromGen(function* () {
      yield* box("a");
    }),
  ).toEqualTypeOf<LazyPromise<void>>();

  expectTypeOf(
    fromGen(function* () {
      yield* box(new ErrorBox("error a"));
    }),
  ).toEqualTypeOf<LazyPromise<void | ErrorBox<"error a">>>();

  /** @ts-expect-error */
  fromGen(function* () {
    yield new LazyPromise<"a">(() => {});
  });

  const badGeneratorFunction = function* () {
    yield new LazyPromise<"a">(() => {});
  };
  /** @ts-expect-error */
  fromGen(badGeneratorFunction);

  /** @ts-expect-error */
  fromGen(function* () {
    yield* "a";
  });

  /** @ts-expect-error */
  fromGen(function* () {
    yield* ["a"];
  });

  /** @ts-expect-error */
  fromGen(function* () {
    yield* [new LazyPromise<"a">(() => {})];
  });

  // Return generic type.
  const f1 = <T>(arg: T) => {
    const promise = fromGen(function* () {
      return arg;
    });
    return promise.map((x) => x);
  };
  expectTypeOf(f1("a" as const)).toEqualTypeOf<LazyPromise<"a">>();

  // Yield generic type.
  const f2 = <T>(arg: T) => {
    const promise = fromGen(function* () {
      yield* box(new ErrorBox(arg));
      return { prop: yield* box(arg) };
    });
    return promise.map((x) => x);
  };
  expectTypeOf(f2("a" as const)).toEqualTypeOf<
    LazyPromise<{ prop: "a" } | ErrorBox<"a">>
  >();

  expectTypeOf(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    fromGen(function* (dep: { callback: null }) {
      yield* new LazyPromise<void, { yielded1: null }>(() => {});
      yield* new LazyPromise<void, { yielded2: null }>(() => {});
      return new LazyPromise<void, { returned: null }>(() => {});
    }),
  ).toEqualTypeOf<
    LazyPromise<
      void,
      { callback: null } & { yielded1: null } & { yielded2: null } & {
        returned: null;
      }
    >
  >();

  expectTypeOf(
    fromGen(function* () {
      yield* new LazyPromise<void, { yielded: null }>(() => {});
      return 42;
    }),
  ).toEqualTypeOf<LazyPromise<number, { yielded: null }>>();
});

test("value of this", () => {
  const promise = fromGen(function* () {
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

test("return value", () => {
  const promise = fromGen(function* () {
    log("in generator");
    return "a";
  });
  promise.subscribe(logConsumer);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "in generator",
      ],
      [
        "handleValue",
        "a",
      ],
    ]
  `);
  promise.subscribe(logConsumer);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "in generator",
      ],
      [
        "handleValue",
        "a",
      ],
    ]
  `);
});

test("yield resolved", () => {
  const promise = fromGen(function* () {
    log("in generator, start");
    const a = yield* box("a");
    log("in generator, after yield", a);
  });
  promise.subscribe();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "in generator, start",
      ],
      [
        "in generator, after yield",
        "a",
      ],
    ]
  `);
});

test("yield async", () => {
  const inner = new LazyPromise<"a">((sink) => {
    log("subscribe inner");
    const timeoutId = setTimeout(() => {
      sink.resolve("a");
    }, 1000);
    return () => {
      log("dispose inner");
      clearTimeout(timeoutId);
    };
  });
  const promise = fromGen(function* () {
    log("in generator, start");
    const a = yield* inner;
    log("in generator, after yield", a);
  });
  const subscription = promise.subscribe();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "in generator, start",
      ],
      [
        "subscribe inner",
      ],
    ]
  `);
  subscription.dispose();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "dispose inner",
      ],
    ]
  `);
  promise.subscribe();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "in generator, start",
      ],
      [
        "subscribe inner",
      ],
    ]
  `);
  vi.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "1000 ms passed",
      [
        "in generator, after yield",
        "a",
      ],
    ]
  `);
});

test("multiple yields", () => {
  const getAsyncPromise = <T>(value: T) =>
    new LazyPromise<T>((sink) => {
      const timeoutId = setTimeout(() => {
        sink.resolve(value);
      }, 1000);
      return () => {
        clearTimeout(timeoutId);
      };
    });

  fromGen(function* () {
    log(yield* box(1));
    log(yield* box(2));
  }).subscribe();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        1,
      ],
      [
        2,
      ],
    ]
  `);

  fromGen(function* () {
    log(yield* getAsyncPromise(1));
    log(yield* getAsyncPromise(2));
  }).subscribe();
  vi.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "1000 ms passed",
      [
        1,
      ],
      "1000 ms passed",
      [
        2,
      ],
    ]
  `);

  fromGen(function* () {
    log(yield* box(1));
    log(yield* getAsyncPromise(2));
    log(yield* box(3));
  }).subscribe();
  vi.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        1,
      ],
      "1000 ms passed",
      [
        2,
      ],
      [
        3,
      ],
    ]
  `);

  fromGen(function* () {
    log(yield* getAsyncPromise(1));
    log(yield* box(2));
    log(yield* getAsyncPromise(3));
  }).subscribe();
  vi.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "1000 ms passed",
      [
        1,
      ],
      [
        2,
      ],
      "1000 ms passed",
      [
        3,
      ],
    ]
  `);
});

test("yield to a sync rejected (uncaught)", () => {
  fromGen(function* () {
    log("in generator");
    yield* rejecting("a");
  }).subscribe(logConsumer);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "in generator",
      ],
      [
        "handleError",
        "a",
      ],
    ]
  `);
});

test("yield to a sync rejected (caught)", () => {
  fromGen(function* () {
    log("in generator");
    try {
      yield* rejecting("a");
    } catch (e) {
      log("in catch");
      expect(e).toMatchInlineSnapshot(`"a"`);
      return "b";
    }
  }).subscribe(logConsumer);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "in generator",
      ],
      [
        "in catch",
      ],
      [
        "handleValue",
        "b",
      ],
    ]
  `);
});

test("yield to an async rejected (uncaught)", () => {
  fromGen(function* () {
    log("in generator");
    yield* new LazyPromise((sink) => {
      setTimeout(() => {
        sink.reject("a");
      }, 1000);
    });
  }).subscribe(logConsumer);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "in generator",
      ],
    ]
  `);
  vi.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "1000 ms passed",
      [
        "handleError",
        "a",
      ],
    ]
  `);
});

test("yield to an async rejected (caught)", () => {
  fromGen(function* () {
    log("in generator");
    try {
      yield* new LazyPromise((sink) => {
        setTimeout(() => {
          sink.reject("a");
        }, 1000);
      });
    } catch (e) {
      log("in catch");
      expect(e).toMatchInlineSnapshot(`"a"`);
      return "b";
    }
  }).subscribe(logConsumer);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "in generator",
      ],
    ]
  `);
  vi.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "1000 ms passed",
      [
        "in catch",
      ],
      [
        "handleValue",
        "b",
      ],
    ]
  `);
});

test("yield to a sync boxed error", () => {
  fromGen(function* () {
    log("in generator");
    const value = yield* box(new ErrorBox("a"));
    log("unreachable", value);
  }).subscribe<unknown>(logConsumer);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "in generator",
      ],
      [
        "handleValue",
        ErrorBox {
          "error": "a",
        },
      ],
    ]
  `);
});

test("yield to an async boxed error", () => {
  fromGen(function* () {
    log("in generator");
    const value = yield* new LazyPromise<ErrorBox<"a">>((sink) => {
      setTimeout(() => {
        sink.resolve(new ErrorBox("a"));
      }, 1000);
    });
    log("unreachable", value);
  }).subscribe<unknown>(logConsumer);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "in generator",
      ],
    ]
  `);
  vi.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "1000 ms passed",
      [
        "handleValue",
        ErrorBox {
          "error": "a",
        },
      ],
    ]
  `);
});

test("a boxed error is not caught by try/catch", () => {
  fromGen(function* () {
    log("in generator");
    try {
      yield* box(new ErrorBox("a"));
      log("unreachable");
    } catch (e) {
      log("unreachable in catch", e);
    }
  }).subscribe<unknown>(logConsumer);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "in generator",
      ],
      [
        "handleValue",
        ErrorBox {
          "error": "a",
        },
      ],
    ]
  `);
});

test("a boxed error runs the finally clause", () => {
  fromGen(function* () {
    log("in generator");
    try {
      yield* box(new ErrorBox("a"));
      log("unreachable");
    } finally {
      log("in finally");
    }
  }).subscribe<unknown>(logConsumer);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "in generator",
      ],
      [
        "in finally",
      ],
      [
        "handleValue",
        ErrorBox {
          "error": "a",
        },
      ],
    ]
  `);
});

test("override a boxed error with return in finally clause", () => {
  fromGen(function* () {
    log("in generator");
    try {
      yield* box(new ErrorBox("a"));
    } finally {
      // eslint-disable-next-line no-unsafe-finally
      return "b";
    }
  }).subscribe<unknown>(logConsumer);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "in generator",
      ],
      [
        "handleValue",
        "b",
      ],
    ]
  `);
});

test("override a boxed error with another boxed error in finally clause", () => {
  fromGen(function* () {
    log("in generator");
    try {
      yield* box(new ErrorBox("a"));
    } finally {
      yield* box(new ErrorBox("b"));
    }
  }).subscribe<unknown>(logConsumer);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "in generator",
      ],
      [
        "handleValue",
        ErrorBox {
          "error": "b",
        },
      ],
    ]
  `);
});

test("override a boxed error with rejection in finally clause", () => {
  fromGen(function* () {
    log("in generator");
    try {
      yield* box(new ErrorBox("a"));
    } finally {
      yield* rejecting("b");
    }
  }).subscribe<unknown>(logConsumer);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "in generator",
      ],
      [
        "handleError",
        "b",
      ],
    ]
  `);
});

test("throw in callback", () => {
  const promise = fromGen(() => {
    throw "oops";
  });
  promise.subscribe(logConsumer);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleError",
        "oops",
      ],
    ]
  `);
});

test("throw at the start of the generator", () => {
  fromGen(function* () {
    throw "oops";
  }).subscribe(logConsumer);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleError",
        "oops",
      ],
    ]
  `);
});

test("throw in the middle of a sync generator", () => {
  fromGen(function* () {
    yield* box();
    throw "oops";
  }).subscribe(logConsumer);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleError",
        "oops",
      ],
    ]
  `);
});

test("throw in the middle of an async generator", () => {
  fromGen(function* () {
    yield* new LazyPromise<void>((sink) => {
      setTimeout(() => {
        sink.resolve();
      }, 1000);
    });
    throw "oops";
  }).subscribe(logConsumer);
  vi.runAllTimers();
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

test("empty iterator", () => {
  const promise = fromGen(function* () {
    log("in generator");
    yield* [];
    return "a";
  });
  promise.subscribe(logConsumer);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "in generator",
      ],
      [
        "handleValue",
        "a",
      ],
    ]
  `);
});

test("return in try clause", () => {
  const promise = fromGen(function* () {
    log("in generator");
    try {
      return "a";
    } finally {
      log("yielded", yield* box(1));
    }
  });
  promise.subscribe(logConsumer);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "in generator",
      ],
      [
        "yielded",
        1,
      ],
      [
        "handleValue",
        "a",
      ],
    ]
  `);
});

test("throw in try clause", () => {
  fromGen(function* () {
    log("in generator");
    try {
      throw "a";
    } finally {
      log("yielded", yield* box(1));
    }
  }).subscribe(logConsumer);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "in generator",
      ],
      [
        "yielded",
        1,
      ],
      [
        "handleError",
        "a",
      ],
    ]
  `);
});

test("override an error thrown in try clause with return", () => {
  fromGen(function* () {
    log("in generator");
    try {
      throw "a";
    } finally {
      log("yielded", yield* box(1));
      // eslint-disable-next-line no-unsafe-finally
      return undefined;
    }
  }).subscribe(logConsumer);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "in generator",
      ],
      [
        "yielded",
        1,
      ],
      [
        "handleValue",
        undefined,
      ],
    ]
  `);
});

test("override rejection with another rejection in finally clause (sync)", () => {
  const promise = fromGen(function* () {
    log("in generator");
    try {
      return yield* rejecting("a");
    } finally {
      yield* rejecting("b");
    }
  });
  promise.subscribe(logConsumer);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "in generator",
      ],
      [
        "handleError",
        "b",
      ],
    ]
  `);
});

test("override rejection with another rejection in finally clause (async)", () => {
  const promise = fromGen(function* () {
    log("in generator");
    try {
      return yield* new LazyPromise<never>((sink) => {
        setTimeout(() => {
          sink.reject("a");
        }, 1000);
      });
    } finally {
      yield* new LazyPromise<never>((sink) => {
        setTimeout(() => {
          sink.reject("b");
        }, 1000);
      });
    }
  });
  promise.subscribe(logConsumer);
  vi.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "in generator",
      ],
      "2000 ms passed",
      [
        "handleError",
        "b",
      ],
    ]
  `);
});

test("override rejection with throw in finally clause (sync)", () => {
  const promise = fromGen(function* () {
    log("in generator");
    try {
      return yield* rejecting("a");
    } finally {
      // eslint-disable-next-line no-unsafe-finally
      throw "b";
    }
  });
  promise.subscribe(logConsumer);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "in generator",
      ],
      [
        "handleError",
        "b",
      ],
    ]
  `);
});

test("override rejection with throw in finally clause (async)", () => {
  const promise = fromGen(function* () {
    log("in generator");
    try {
      return yield* new LazyPromise<never>((sink) => {
        setTimeout(() => {
          sink.reject("a");
        }, 1000);
      });
    } finally {
      // eslint-disable-next-line no-unsafe-finally
      throw "b";
    }
  });
  promise.subscribe(logConsumer);
  vi.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "in generator",
      ],
      "1000 ms passed",
      [
        "handleError",
        "b",
      ],
    ]
  `);
});

test("ignore the finally clause when unsubscribed", () => {
  const promise = fromGen(function* () {
    log("in generator");
    try {
      yield* never;
    } finally {
      log("in finally");
    }
  });
  promise.subscribe();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "in generator",
      ],
    ]
  `);
});

test("synchronously unsubscribe in producer", () => {
  const promise = fromGen(function* () {
    yield* new LazyPromise<void>((sink) => {
      setTimeout(() => {
        sink.resolve();
      }, 1000);
    });
    yield* new LazyPromise<void>(() => {
      // eslint-disable-next-line no-use-before-define
      subscription.dispose();
      return () => {
        log("dispose");
      };
    });
    log("never get here");
  });
  const subscription = promise.subscribe(logConsumer);
  vi.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "1000 ms passed",
      [
        "dispose",
      ],
    ]
  `);
});

test("synchronously unsubscribe then resolve in producer", () => {
  const promise = fromGen(function* () {
    yield* new LazyPromise<void>((sink) => {
      setTimeout(() => {
        sink.resolve();
      }, 1000);
    });
    yield* new LazyPromise<void>((sink) => {
      // eslint-disable-next-line no-use-before-define
      subscription.dispose();
      sink.resolve();
    });
    log("never get here");
  });
  const subscription = promise.subscribe(logConsumer);
  vi.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`[]`);
});

test("synchronously unsubscribe then reject in producer", () => {
  const promise = fromGen(function* () {
    yield* new LazyPromise<void>((sink) => {
      setTimeout(() => {
        sink.resolve();
      }, 1000);
    });
    yield* new LazyPromise<void>((sink) => {
      // eslint-disable-next-line no-use-before-define
      subscription.dispose();
      sink.reject(1);
    });
    log("never get here");
  });
  const subscription = promise.subscribe(logConsumer);
  vi.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`[]`);
});

test("unsubscribe in generator after sync resolve", () => {
  const promise = fromGen(function* () {
    yield* new LazyPromise<void>((sink) => {
      setTimeout(() => {
        sink.resolve();
      }, 1000);
    });
    yield* box();
    // eslint-disable-next-line no-use-before-define
    subscription.dispose();
    yield* new LazyPromise<void>(() => {
      log("never get here");
    });
  });
  const subscription = promise.subscribe(logConsumer);
  vi.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`[]`);
});

test("unsubscribe in generator after sync reject", () => {
  const promise = fromGen(function* () {
    yield* new LazyPromise<void>((sink) => {
      setTimeout(() => {
        sink.resolve();
      }, 1000);
    });
    try {
      yield* rejecting(1);
    } catch {
      // eslint-disable-next-line no-use-before-define
      subscription.dispose();
    }
    yield* new LazyPromise<void>(() => {
      log("never get here");
    });
  });
  const subscription = promise.subscribe(logConsumer);
  vi.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`[]`);
});

test("unsubscribe in generator after async resolve", () => {
  const promise = fromGen(function* () {
    yield* new LazyPromise<void>((sink) => {
      setTimeout(() => {
        sink.resolve();
      }, 1000);
    });
    // eslint-disable-next-line no-use-before-define
    subscription.dispose();
    yield* new LazyPromise<void>(() => {
      log("never get here");
    });
  });
  const subscription = promise.subscribe(logConsumer);
  vi.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`[]`);
});

test("unsubscribe in generator after async reject", () => {
  const promise = fromGen(function* () {
    try {
      yield* new LazyPromise<void>((sink) => {
        setTimeout(() => {
          sink.reject(1);
        }, 1000);
      });
    } catch {
      // eslint-disable-next-line no-use-before-define
      subscription.dispose();
    }
    yield* new LazyPromise<void>(() => {
      log("never get here");
    });
  });
  const subscription = promise.subscribe(logConsumer);
  vi.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`[]`);
});

test("dependency injection", () => {
  fromGen(function* (dep: "dep") {
    log("callback dep", dep);
    yield* new LazyPromise<void, "dep">((sink, dep) => {
      log("yielded promise dep", dep);
      sink.resolve();
    });
    return new LazyPromise<void, "dep">((sink, dep) => {
      log("returned promise dep", dep);
    });
  }).subscribe(undefined, "dep");

  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "callback dep",
        "dep",
      ],
      [
        "yielded promise dep",
        "dep",
      ],
      [
        "returned promise dep",
        "dep",
      ],
    ]
  `);
});

test("stack overflow with resolved lazy promises", () => {
  const getMaxStackDepth = (depth = 1) => {
    try {
      return getMaxStackDepth(depth + 1);
    } catch (e) {
      return depth;
    }
  };
  const maxStackDepth = getMaxStackDepth();
  fromGen(function* () {
    for (let i = 0; i < maxStackDepth + 10; i++) {
      yield* box();
    }
  }).subscribe();

  const getInner = (index: number) =>
    new LazyPromise<void>((sink) => {
      log("start", index);
      sink.resolve();
      log("end", index);
    });
  fromGen(function* () {
    yield* getInner(1);
    yield* getInner(2);
    yield* getInner(3);
  }).subscribe();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "start",
        1,
      ],
      [
        "end",
        1,
      ],
      [
        "start",
        2,
      ],
      [
        "end",
        2,
      ],
      [
        "start",
        3,
      ],
      [
        "end",
        3,
      ],
    ]
  `);
});

test("stack overflow with rejected lazy promises", () => {
  const getMaxStackDepth = (depth = 1) => {
    try {
      return getMaxStackDepth(depth + 1);
    } catch (e) {
      return depth;
    }
  };
  const maxStackDepth = getMaxStackDepth();
  fromGen(function* () {
    for (let i = 0; i < maxStackDepth + 10; i++) {
      try {
        yield* rejecting();
        // eslint-disable-next-line no-empty
      } catch (e) {}
    }
  }).subscribe();

  const getInner = (index: number) =>
    new LazyPromise<void>((sink) => {
      log("start", index);
      sink.reject(undefined);
      log("end", index);
    });
  fromGen(function* () {
    try {
      yield* getInner(1);
      // eslint-disable-next-line no-empty
    } catch (e) {}
    try {
      yield* getInner(2);
      // eslint-disable-next-line no-empty
    } catch (e) {}
    try {
      yield* getInner(3);
      // eslint-disable-next-line no-empty
    } catch (e) {}
  }).subscribe();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "start",
        1,
      ],
      [
        "end",
        1,
      ],
      [
        "start",
        2,
      ],
      [
        "end",
        2,
      ],
      [
        "start",
        3,
      ],
      [
        "end",
        3,
      ],
    ]
  `);
});
