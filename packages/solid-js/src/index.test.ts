import type { ErrorBox } from "@lazy-promise/core";
import {
  box,
  fromGen,
  inTimeout,
  LazyPromise,
  rejecting,
} from "@lazy-promise/core";
import type { OwnerDep } from "@lazy-promise/solid-js";
import { glue, noop, runWithOwnerDep } from "@lazy-promise/solid-js";
import {
  createEffect,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  getOwner,
  onCleanup,
} from "solid-js";
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

/**
 * Lets Solid's promise callbacks and anything they queue run to completion.
 */
const settleMicrotasks = async () => {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
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
  const plain = new LazyPromise<number>(() => {});
  const boxedError = new LazyPromise<number | ErrorBox<"error1">>(() => {});
  const ownerDepOnly = new LazyPromise<string, OwnerDep>(() => {});
  const extraDep = new LazyPromise<string, OwnerDep & { api: number }>(
    () => {},
  );
  const neverDep = new LazyPromise<string, never>(() => {});

  expectTypeOf(glue(plain)).toEqualTypeOf<AsyncIterable<number>>();
  expectTypeOf(plain.pipe(glue)).toEqualTypeOf<AsyncIterable<number>>();
  expectTypeOf(glue(ownerDepOnly)).toEqualTypeOf<AsyncIterable<string>>();
  expectTypeOf(ownerDepOnly.pipe(glue)).toEqualTypeOf<AsyncIterable<string>>();

  /** @ts-expect-error */
  glue(boxedError);
  /** @ts-expect-error */
  boxedError.pipe(glue);
  expectTypeOf(glue(boxedError.catchBoxed(() => 0))).toEqualTypeOf<
    AsyncIterable<number>
  >();

  /** @ts-expect-error */
  glue(extraDep);
  /** @ts-expect-error */
  extraDep.pipe(glue);
  expectTypeOf(
    glue(extraDep.inject((dep: OwnerDep) => ({ ...dep, api: 1 }))),
  ).toEqualTypeOf<AsyncIterable<string>>();

  /** @ts-expect-error */
  glue(neverDep);

  expectTypeOf(runWithOwnerDep(() => 42)).toEqualTypeOf<
    LazyPromise<number, OwnerDep>
  >();
  expectTypeOf(runWithOwnerDep(() => box("x"))).toEqualTypeOf<
    LazyPromise<"x", OwnerDep>
  >();
  expectTypeOf(
    runWithOwnerDep(
      (): LazyPromise<string, OwnerDep & { api: number }> =>
        new LazyPromise(() => {}),
    ),
  ).toEqualTypeOf<LazyPromise<string, OwnerDep & { api: number }>>();
  expectTypeOf(glue(runWithOwnerDep(() => 42))).toEqualTypeOf<
    AsyncIterable<number>
  >();

  expectTypeOf(noop).toEqualTypeOf<() => void>();
});

//
// Memos
//

test("memo: synchronously resolving LazyPromise settles the memo synchronously", () => {
  const [state, dispose] = createRoot((dispose) => {
    const [a, setA] = createSignal(0);
    const memo = createMemo(() => box(a() * 2).pipe(glue));
    return [{ memo, setA }, dispose] as const;
  });
  expect(state.memo()).toBe(0);
  state.setA(1);
  flush();
  expect(state.memo()).toBe(2);
  dispose();
});

test("memo: asynchronously resolving LazyPromise", async () => {
  const [state, dispose] = createRoot((dispose) => {
    const [a, setA] = createSignal(0);
    const memo = createMemo(() =>
      box(a())
        .finally(() => inTimeout(1000))
        .pipe(glue),
    );
    createEffect(
      () => memo(),
      (value) => {
        log("effect", value);
      },
    );
    return [{ setA }, dispose] as const;
  });
  flush();
  expect(readLog()).toMatchInlineSnapshot(`[]`);
  await vi.advanceTimersByTimeAsync(1000);
  await settleMicrotasks();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "1000 ms passed",
      [
        "effect",
        0,
      ],
    ]
  `);
  state.setA(1);
  flush();
  await vi.advanceTimersByTimeAsync(1000);
  await settleMicrotasks();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "1000 ms passed",
      [
        "effect",
        1,
      ],
    ]
  `);
  dispose();
});

test("memo: subscription is disposed on re-run and on root dispose", async () => {
  const [state, dispose] = createRoot((dispose) => {
    const [a, setA] = createSignal(0);
    const memo = createMemo(() => {
      const value = a();
      return new LazyPromise<number>(() => {
        log("subscribe", value);
        return () => {
          log("dispose", value);
        };
      }).pipe(glue);
    });
    createEffect(
      () => memo(),
      (value) => {
        log("effect", value);
      },
    );
    return [{ setA }, dispose] as const;
  });
  flush();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "subscribe",
        0,
      ],
    ]
  `);
  state.setA(1);
  flush();
  await settleMicrotasks();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "subscribe",
        1,
      ],
      [
        "dispose",
        0,
      ],
    ]
  `);
  dispose();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "dispose",
        1,
      ],
    ]
  `);
});

test("reads in the LazyPromise producer are not tracked and have no owner", () => {
  const [state, dispose] = createRoot((dispose) => {
    const [a, setA] = createSignal(0);
    const [b, setB] = createSignal(0);
    createEffect(
      () =>
        box(a())
          .map(() => {
            log("fired", b(), getOwner());
          })
          .pipe(glue),
      noop,
    );
    return [{ setA, setB }, dispose] as const;
  });
  flush();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "fired",
        0,
        null,
      ],
    ]
  `);
  state.setB(1);
  flush();
  expect(readLog()).toMatchInlineSnapshot(`[]`);
  state.setA(1);
  flush();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "fired",
        1,
        null,
      ],
    ]
  `);
  dispose();
});

//
// Effects
//

test("effect: value lands in the effect function", () => {
  const [state, dispose] = createRoot((dispose) => {
    const [a, setA] = createSignal(0);
    createEffect(
      () => box(a() * 2).pipe(glue),
      (value) => {
        log("effect", value);
      },
    );
    return [{ setA }, dispose] as const;
  });
  flush();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "effect",
        0,
      ],
    ]
  `);
  state.setA(1);
  flush();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "effect",
        2,
      ],
    ]
  `);
  dispose();
});

test("effect: synchronous rejection reaches the error arm of an effect bundle", () => {
  const dispose = createRoot((dispose) => {
    createEffect(() => rejecting("oops").pipe(glue), {
      effect: noop,
      error: (error) => {
        log("error", error);
      },
    });
    return dispose;
  });
  flush();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "error",
        "oops",
      ],
    ]
  `);
  dispose();
});

test("effect: asynchronous rejection reaches the error arm of an effect bundle", async () => {
  const dispose = createRoot((dispose) => {
    createEffect(
      () =>
        inTimeout(1000)
          .map(() => rejecting("oops"))
          .pipe(glue),
      {
        effect: noop,
        error: (error) => {
          log("error", error);
        },
      },
    );
    return dispose;
  });
  flush();
  expect(readLog()).toMatchInlineSnapshot(`[]`);
  await vi.advanceTimersByTimeAsync(1000);
  await settleMicrotasks();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "1000 ms passed",
      [
        "error",
        "oops",
      ],
    ]
  `);
  dispose();
});

test("effect: onCleanup registered through runWithOwnerDep is disposed on re-run", async () => {
  const [state, dispose] = createRoot((dispose) => {
    const [a, setA] = createSignal(0);
    createEffect(() => {
      const value = a();
      return fromGen(function* () {
        log("start", value);
        yield* runWithOwnerDep(() => {
          onCleanup(() => {
            log("cleanup", value);
          });
        });
        yield* inTimeout(1000);
        log("done", value);
      }).pipe(glue);
    }, noop);
    return [{ setA }, dispose] as const;
  });
  flush();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "start",
        0,
      ],
    ]
  `);
  // The signal changes mid-flight: the first run's cleanup must run and the
  // first run's timeout must be canceled.
  await vi.advanceTimersByTimeAsync(500);
  state.setA(1);
  flush();
  await settleMicrotasks();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "500 ms passed",
      [
        "start",
        1,
      ],
      [
        "cleanup",
        0,
      ],
    ]
  `);
  await vi.advanceTimersByTimeAsync(1000);
  await settleMicrotasks();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "1000 ms passed",
      [
        "done",
        1,
      ],
    ]
  `);
  dispose();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "cleanup",
        1,
      ],
    ]
  `);
});

test("renderEffect: works with noop", () => {
  const dispose = createRoot((dispose) => {
    createRenderEffect(
      () =>
        box(undefined)
          .map(() => {
            log("fired");
          })
          .pipe(glue),
      noop,
    );
    return dispose;
  });
  flush();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "fired",
      ],
    ]
  `);
  dispose();
});

test("runWithOwnerDep: provides the owner and unboxes a returned LazyPromise", () => {
  const dispose = createRoot((dispose) => {
    createEffect(
      () =>
        fromGen(function* () {
          const value = yield* runWithOwnerDep(() => {
            log("owner", getOwner() !== null);
            return box("value");
          });
          return value;
        }).pipe(glue),
      (value) => {
        log("effect", value);
      },
    );
    return dispose;
  });
  flush();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "owner",
        true,
      ],
      [
        "effect",
        "value",
      ],
    ]
  `);
  dispose();
});
