import {
  box,
  fromGenerator,
  LazyPromise,
  map,
  never,
  rejected,
  TypedError,
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
  expectTypeOf(
    fromGenerator(function* () {
      const value = yield* new LazyPromise<"a" | "b" | TypedError<"error1">>(
        () => {},
      );
      expectTypeOf(value).toEqualTypeOf<"a" | "b" | TypedError<"error1">>();
      if (value === "a") {
        return yield* new LazyPromise<TypedError<"error2">>(() => {});
      }
      return value;
    }),
  ).toEqualTypeOf<
    LazyPromise<TypedError<"error2"> | TypedError<"error1"> | "b">
  >();

  expectTypeOf(
    fromGenerator(function* () {
      return 1 as const;
    }),
  ).toEqualTypeOf<LazyPromise<1>>();

  expectTypeOf(fromGenerator(function* () {})).toEqualTypeOf<
    LazyPromise<void>
  >();

  expectTypeOf(
    fromGenerator(function* () {
      if (true as boolean) {
        return new LazyPromise<TypedError<"error1">>(() => {});
      }
      return new LazyPromise<"a">(() => {});
    }),
  ).toEqualTypeOf<
    LazyPromise<LazyPromise<TypedError<"error1">> | LazyPromise<"a">>
  >();

  expectTypeOf(
    fromGenerator(function* () {
      throw "a";
    }),
  ).toEqualTypeOf<LazyPromise<never>>();

  /** @ts-expect-error */
  fromGenerator(function* () {
    yield new LazyPromise<"a">(() => {});
  });

  /** @ts-expect-error */
  fromGenerator(function* () {
    yield* "a";
  });

  /** @ts-expect-error */
  fromGenerator(function* () {
    yield* ["a"];
  });

  /** @ts-expect-error */
  fromGenerator(function* () {
    yield* [new LazyPromise<"a">(() => {})];
  });

  // Return generic type.
  const f1 = <T>(arg: T) => {
    const promise = fromGenerator(function* () {
      return arg;
    });
    return promise.pipe(map((x) => x));
  };
  expectTypeOf(f1("a" as const)).toEqualTypeOf<LazyPromise<"a">>();

  // Yield generic type.
  const f2 = <T>(arg: T) => {
    const promise = fromGenerator(function* () {
      yield* box(new TypedError(arg));
      return { prop: yield* box(arg) };
    });
    return promise.pipe(map((x) => x));
  };
  expectTypeOf(f2("a" as const)).toEqualTypeOf<LazyPromise<{ prop: "a" }>>();
});

test("return value", () => {
  const promise = fromGenerator(function* () {
    log("in generator");
    return "a";
  });
  const unsubscribe = promise.subscribe((value) => {
    log("handleValue", value);
  });
  expect(unsubscribe).toMatchInlineSnapshot(`undefined`);
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
  const promise = fromGenerator(function* () {
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
  const inner = new LazyPromise<"a">((resolve) => {
    log("subscribe inner");
    const timeoutId = setTimeout(() => {
      resolve("a");
    }, 1000);
    return () => {
      log("dispose inner");
      clearTimeout(timeoutId);
    };
  });
  const promise = fromGenerator(function* () {
    log("in generator, start");
    const a = yield* inner;
    log("in generator, after yield", a);
  });
  const unsubscribe = promise.subscribe();
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
  unsubscribe!();
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
    new LazyPromise<T>((resolve) => {
      const timeoutId = setTimeout(() => {
        resolve(value);
      }, 1000);
      return () => {
        clearTimeout(timeoutId);
      };
    });

  fromGenerator(function* () {
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

  fromGenerator(function* () {
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

  fromGenerator(function* () {
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

  fromGenerator(function* () {
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
  fromGenerator(function* () {
    log("in generator");
    yield* rejected("a");
  }).subscribe(undefined, (error) => {
    log("handleError", error);
  });
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
  fromGenerator(function* () {
    log("in generator");
    try {
      yield* rejected("a");
    } catch (e) {
      log("in catch");
      expect(e).toMatchInlineSnapshot(`"a"`);
      return "b";
    }
  }).subscribe((value) => {
    log("handleValue", value);
  });
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
  fromGenerator(function* () {
    log("in generator");
    yield* new LazyPromise((resolve, reject) => {
      setTimeout(() => {
        reject("a");
      }, 1000);
      return () => {};
    });
  }).subscribe(undefined, (error) => {
    log("handleError", error);
  });
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
  fromGenerator(function* () {
    log("in generator");
    try {
      yield* new LazyPromise((resolve, reject) => {
        setTimeout(() => {
          reject("a");
        }, 1000);
        return () => {};
      });
    } catch (e) {
      log("in catch");
      expect(e).toMatchInlineSnapshot(`"a"`);
      return "b";
    }
  }).subscribe((value) => {
    log("handleValue", value);
  });
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

test("throw in callback", () => {
  const promise = fromGenerator(() => {
    throw "oops";
  });
  promise.subscribe(undefined, (error) => {
    log("handleError", error);
  });
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
  fromGenerator(function* () {
    throw "oops";
  }).subscribe(undefined, (error) => {
    log("handleError", error);
  });
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
  fromGenerator(function* () {
    yield* box();
    throw "oops";
  }).subscribe(undefined, (error) => {
    log("handleError", error);
  });
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
  fromGenerator(function* () {
    yield* new LazyPromise<void>((resolve) => {
      setTimeout(() => {
        resolve();
      }, 1000);
      return () => {};
    });
    throw "oops";
  }).subscribe(undefined, (error) => {
    log("handleError", error);
  });
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
  const promise = fromGenerator(function* () {
    log("in generator");
    yield* [];
    return "a";
  });
  promise.subscribe((value) => {
    log("handleValue", value);
  });
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
  const promise = fromGenerator(function* () {
    log("in generator");
    try {
      return "a";
    } finally {
      log("yielded", yield* box(1));
    }
  });
  promise.subscribe((value) => {
    log("handleValue", value);
  });
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
  fromGenerator(function* () {
    log("in generator");
    try {
      throw "a";
    } finally {
      log("yielded", yield* box(1));
    }
  }).subscribe(
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
  fromGenerator(function* () {
    log("in generator");
    try {
      throw "a";
    } finally {
      log("yielded", yield* box(1));
      // eslint-disable-next-line no-unsafe-finally
      return undefined;
    }
  }).subscribe((value) => {
    log("handleValue", value);
  });
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
  const promise = fromGenerator(function* () {
    log("in generator");
    try {
      return yield* rejected("a");
    } finally {
      yield* rejected("b");
    }
  });
  promise.subscribe(undefined, (error) => {
    log("handleError", error);
  });
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
  const promise = fromGenerator(function* () {
    log("in generator");
    try {
      return yield* new LazyPromise<never>((resolve, reject) => {
        setTimeout(() => {
          reject("a");
        }, 1000);
        return () => {};
      });
    } finally {
      yield* new LazyPromise<never>((resolve, reject) => {
        setTimeout(() => {
          reject("b");
        }, 1000);
        return () => {};
      });
    }
  });
  promise.subscribe(undefined, (error) => {
    log("handleError", error);
  });
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
  const promise = fromGenerator(function* () {
    log("in generator");
    try {
      return yield* rejected("a");
    } finally {
      // eslint-disable-next-line no-unsafe-finally
      throw "b";
    }
  });
  promise.subscribe(undefined, (error) => {
    log("handleError", error);
  });
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
  const promise = fromGenerator(function* () {
    log("in generator");
    try {
      return yield* new LazyPromise<never>((resolve, reject) => {
        setTimeout(() => {
          reject("a");
        }, 1000);
        return () => {};
      });
    } finally {
      // eslint-disable-next-line no-unsafe-finally
      throw "b";
    }
  });
  promise.subscribe(undefined, (error) => {
    log("handleError", error);
  });
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
  const promise = fromGenerator(function* () {
    log("in generator");
    try {
      yield* never;
    } finally {
      log("in finally");
    }
  });
  const unsubscribe = promise.subscribe();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "in generator",
      ],
    ]
  `);
  expect(unsubscribe).toMatchInlineSnapshot(`undefined`);
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
  fromGenerator(function* () {
    for (let i = 0; i < maxStackDepth + 10; i++) {
      yield* box();
    }
  }).subscribe();

  const getInner = (index: number) =>
    new LazyPromise<void>((resolve) => {
      log("start", index);
      resolve();
      log("end", index);
    });
  fromGenerator(function* () {
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
  fromGenerator(function* () {
    for (let i = 0; i < maxStackDepth + 10; i++) {
      try {
        yield* rejected();
        // eslint-disable-next-line no-empty
      } catch (e) {}
    }
  }).subscribe();

  const getInner = (index: number) =>
    new LazyPromise<void>((resolve, reject) => {
      log("start", index);
      reject(undefined);
      log("end", index);
    });
  fromGenerator(function* () {
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
