import { LazyPromise, TypedError, box } from "@lazy-promise/core";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { computed, effect, flush, signal, trigger } from "./index.js";

const logContents: unknown[] = [];
let logTime = 0;

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

//
// Effects
//

test("effect: reads in LazyPromise producer are not tracked", () => {
  const a = signal(0);
  const b = signal(0);

  // The effect callback reads `a` in tracked context, then returns a
  // LazyPromise whose producer reads `b` in the (untracked) subscription
  // context. Changes to `b` must NOT re-run the effect.
  effect(() => {
    const aVal = a();
    return box(aVal).map(() => {
      log("fired", b());
    });
  });

  // Initial run: box resolves synchronously, map fires, b is read
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "fired",
        0,
      ],
    ]
  `);

  // b changes: no reactive dependency on b, effect must not re-run
  b(1);
  flush();
  expect(readLog()).toMatchInlineSnapshot(`[]`);

  // a changes: effect re-runs, map fires again reading the current b value
  a(1);
  flush();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "fired",
        1,
      ],
    ]
  `);
});

test("effect: previous LazyPromise subscription is cancelled when effect re-runs", () => {
  const a = signal(0);

  effect(() => {
    a();
    log("run");
    return new LazyPromise(() => {
      log("produce");
      return () => {
        log("teardown");
      };
    });
  });

  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "run",
      ],
      [
        "produce",
      ],
    ]
  `);

  flush();

  expect(readLog()).toMatchInlineSnapshot(`[]`);

  a(1);
  flush();

  // teardown fires before the new run
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "teardown",
      ],
      [
        "run",
      ],
      [
        "produce",
      ],
    ]
  `);

  a(2);
  flush();

  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "teardown",
      ],
      [
        "run",
      ],
      [
        "produce",
      ],
    ]
  `);
});

test("effect: LazyPromise subscription is cancelled when effect is disposed", () => {
  const dispose = effect(
    () =>
      new LazyPromise<number>(() => () => {
        log("teardown");
      }),
  );

  expect(readLog()).toMatchInlineSnapshot(`[]`);

  dispose();

  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "teardown",
      ],
    ]
  `);
});

// @ts-expect-error effect must not accept a callback that returns LazyPromise<TypedError<X>>
effect(() => new LazyPromise<TypedError<string>>(() => {}));

// @ts-expect-error effect must not accept a callback that returns LazyPromise<T | TypedError<X>>
effect(() => new LazyPromise<number | TypedError<string>>(() => {}));

//
// Memos
//

test("computed: proxy LazyPromise fires when original settles", () => {
  let resolveOriginal!: (v: number) => void;

  const memo = computed(
    () =>
      new LazyPromise<number>((subscriber) => {
        resolveOriginal = (v) => {
          subscriber.resolve(v);
        };
      }),
  );

  effect(() =>
    memo().map((v) => {
      log("result", v);
    }),
  );

  expect(readLog()).toMatchInlineSnapshot(`[]`);

  resolveOriginal(42);

  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "result",
        42,
      ],
    ]
  `);
});

test("computed: proxy propagates rejection from original", () => {
  let rejectOriginal!: (error: unknown) => void;
  const a = signal(0);

  const memo = computed(
    () =>
      new LazyPromise<number>((subscriber) => {
        log("produce");
        rejectOriginal = (e) => {
          subscriber.reject(e);
        };
      }),
  );

  effect(() => {
    log("effect");
    a();
    return memo().catchRejection((error) => {
      log("caught", error);
    });
  });

  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "effect",
      ],
      [
        "produce",
      ],
    ]
  `);

  rejectOriginal("oops");

  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "caught",
        "oops",
      ],
    ]
  `);

  a(1);
  flush();

  // Rejections aren't cached.
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "effect",
      ],
      [
        "produce",
      ],
    ]
  `);
});

test("computed: proxy propagates TypedError from original", () => {
  let resolveOriginal!: (value: number | TypedError<"oops">) => void;
  const a = signal(0);

  const memo = computed(
    () =>
      new LazyPromise<number | TypedError<"oops">>((subscriber) => {
        log("produce");
        resolveOriginal = (value) => {
          subscriber.resolve(value);
        };
      }),
  );

  effect(() => {
    log("effect");
    a();
    return memo().catchTypedError((error) => {
      log("caught", error);
    });
  });

  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "effect",
      ],
      [
        "produce",
      ],
    ]
  `);

  resolveOriginal(new TypedError("oops"));

  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "caught",
        "oops",
      ],
    ]
  `);

  a(1);
  flush();

  // Typed errors aren't cached.
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "effect",
      ],
      [
        "produce",
      ],
    ]
  `);
});

test("computed: new proxy when new original synchronously resolves to TypedError", () => {
  const a = signal(0);
  let resolveWithError = false;
  const typedError = new TypedError("oops");

  const memo = computed(() => {
    a();
    return new LazyPromise<number | TypedError<string>>((subscriber) => {
      log("produce");
      subscriber.resolve(resolveWithError ? typedError : 42);
    });
  });

  effect(() =>
    memo()
      .map((value) => {
        log("value", value);
      })
      .catchTypedError((error) => {
        log("caught", error);
      }),
  );

  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "produce",
      ],
      [
        "value",
        42,
      ],
    ]
  `);

  resolveWithError = true;
  a(1);
  flush();
  // Double "produce" call will be addressed in a separate commit.
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "produce",
      ],
      [
        "produce",
      ],
      [
        "caught",
        "oops",
      ],
    ]
  `);

  a(2);
  flush();
  // Typed error is not cached.
  // Double "produce" call will be addressed in a separate commit.
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "produce",
      ],
      [
        "produce",
      ],
      [
        "caught",
        "oops",
      ],
    ]
  `);
});

test("computed: new proxy when new original synchronously rejects", () => {
  const a = signal(0);
  let rejectNext = false;

  const memo = computed(() => {
    a();
    return new LazyPromise<number>((subscriber) => {
      log("produce");
      if (rejectNext) {
        subscriber.reject("oops");
      } else {
        subscriber.resolve(42);
      }
    });
  });

  effect(() =>
    memo()
      .map((value) => {
        log("value", value);
      })
      .catchRejection((error) => {
        log("rejected", error);
      }),
  );

  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "produce",
      ],
      [
        "value",
        42,
      ],
    ]
  `);

  rejectNext = true;
  a(1);
  flush();
  // Double "produce" call will be addressed in a separate commit.
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "produce",
      ],
      [
        "produce",
      ],
      [
        "rejected",
        "oops",
      ],
    ]
  `);

  a(2);
  flush();
  // Rejections are not cached.
  // Double "produce" call will be addressed in a separate commit.
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "produce",
      ],
      [
        "produce",
      ],
      [
        "rejected",
        "oops",
      ],
    ]
  `);
});

test("computed: multiple subscribers to proxy share result, original subscribed only once", () => {
  let resolveOriginal!: (v: number) => void;

  const memo = computed(
    () =>
      new LazyPromise<number>((subscriber) => {
        log("subscribed");
        resolveOriginal = (v) => {
          subscriber.resolve(v);
        };
      }),
  );

  effect(() =>
    memo().map((v) => {
      log("e1", v);
    }),
  );

  effect(() =>
    memo().map((v) => {
      log("e2", v);
    }),
  );

  // "subscribed" appears once – original subscribed only once despite two effects
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "subscribed",
      ],
    ]
  `);

  resolveOriginal(42);

  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "e2",
        42,
      ],
      [
        "e1",
        42,
      ],
    ]
  `);
});

test("computed: original stays subscribed when effect re-runs while proxy is pending", () => {
  const localCount = signal(0);
  let resolveOriginal!: (v: number) => void;

  const memo = computed(
    () =>
      new LazyPromise<number>((subscriber) => {
        log("original subscribed");
        resolveOriginal = (v) => {
          subscriber.resolve(v);
        };
      }),
  );

  effect(() => {
    log("effect", localCount());
    return memo().map((v) => {
      log("value", v);
    });
  });

  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "effect",
        0,
      ],
      [
        "original subscribed",
      ],
    ]
  `);

  // localCount changes → effect re-runs, but original is NOT re-subscribed
  localCount(1);
  flush();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "effect",
        1,
      ],
    ]
  `);

  // Original eventually settles; proxy delivers the value
  resolveOriginal(99);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "value",
        99,
      ],
    ]
  `);
});

test("computed: reads in original producer are not tracked when computed is in graph", () => {
  const a = signal(0);
  const b = signal(0);

  const memo = computed(() => {
    a();
    return new LazyPromise<number>(() => {
      log("produce", b());
    });
  });

  effect(() => memo().map(() => {}));

  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "produce",
        0,
      ],
    ]
  `);

  b(1);
  flush();
  expect(readLog()).toMatchInlineSnapshot(`[]`);

  a(1);
  flush();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "produce",
        1,
      ],
    ]
  `);
});

test("computed: proxy identity preserved when getter re-runs and previous original is still pending", () => {
  const url = signal("a");

  const memo = computed(() => {
    log("memo");
    url();
    return new LazyPromise<number>(() => {
      log("produce");
    });
  });

  effect(() => {
    log("effect");
    return memo().map((v) => {
      log("value", v);
    });
  });

  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "effect",
      ],
      [
        "memo",
      ],
      [
        "produce",
      ],
    ]
  `);

  const proxy1 = memo();

  url("b");
  flush();

  // Since identity is preserved, effect does not re-run.
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "memo",
      ],
      [
        "produce",
      ],
    ]
  `);

  const proxy2 = memo();
  expect(proxy1).toBe(proxy2);
});

test("computed: new proxy when new original synchronously resolves to different value - downstream re-runs", () => {
  const url = signal("a");
  let value = 1;

  const memo = computed(() => {
    url();
    const v = value;
    return new LazyPromise<number>((subscriber) => {
      subscriber.resolve(v);
    });
  });

  const downstream = computed(() => {
    log("downstream");
    return memo();
  });

  effect(() => {
    downstream();
  });

  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "downstream",
      ],
    ]
  `);
  const proxy1 = memo();

  // Previous original settled synchronously with v=1.
  // Getter re-runs with v=2: resolves synchronously to a different value → new proxy.
  value = 2;
  url("b");
  flush();

  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "downstream",
      ],
    ]
  `);

  const proxy2 = memo();
  expect(proxy1).not.toBe(proxy2);
});

test("computed: new proxy returned when getter re-runs, previous original resolved, and new one hasn't", () => {
  let resolveOriginal!: (v: number) => void;
  const url = signal("a");

  const memo = computed(() => {
    url();
    return new LazyPromise<number>((subscriber) => {
      log("produce");
      resolveOriginal = (v) => {
        subscriber.resolve(v);
      };
    });
  });

  effect(() => {
    log("effect");
    return memo().map((v) => {
      log("value", v);
    });
  });

  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "effect",
      ],
      [
        "produce",
      ],
    ]
  `);
  const proxy1 = memo();

  resolveOriginal(1);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "value",
        1,
      ],
    ]
  `);

  url("b");
  flush();

  // Proxy changes identity and this triggers the effect.
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "produce",
      ],
      [
        "effect",
      ],
    ]
  `);

  const proxy2 = memo();
  expect(proxy1).not.toBe(proxy2);
});

test("computed: same proxy returned when getter re-runs and settled value is strictly equal", () => {
  const url = signal("a");

  const memo = computed(() => {
    log("memo");
    url();
    return new LazyPromise<number>((subscriber) => {
      log("produce");
      subscriber.resolve(42);
    });
  });

  expect(readLog()).toMatchInlineSnapshot(`[]`);

  effect(() => {
    log("effect");
    return memo().map((v) => {
      log("value", v);
    });
  });

  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "effect",
      ],
      [
        "memo",
      ],
      [
        "produce",
      ],
      [
        "value",
        42,
      ],
    ]
  `);
  const proxy1 = memo();

  url("b");
  flush();

  // No downstream propagation
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "memo",
      ],
      [
        "produce",
      ],
    ]
  `);

  const proxy2 = memo();
  expect(proxy1).toBe(proxy2);
});

test("computed: untracked - overlapping subscriptions share result, original subscribed once", () => {
  let resolveOriginal!: (v: number) => void;

  const memo = computed(
    () =>
      new LazyPromise<number>((subscriber) => {
        log("produce");
        resolveOriginal = (v) => {
          subscriber.resolve(v);
        };
      }),
  );

  expect(readLog()).toMatchInlineSnapshot(`[]`);

  memo().subscribe({
    resolve: (v) => {
      log("sub1", v);
    },
  });

  // "produce" appears once – multicast, original not re-subscribed
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "produce",
      ],
    ]
  `);

  memo().subscribe({
    resolve: (v) => {
      log("sub2", v);
    },
  });

  // Two overlapping subscriptions to the same proxy (not in dependency graph)
  expect(readLog()).toMatchInlineSnapshot(`[]`);

  resolveOriginal(42);

  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "sub2",
        42,
      ],
      [
        "sub1",
        42,
      ],
    ]
  `);
});

test("computed: untracked - non-overlapping subscriptions each cause a fresh original subscription", () => {
  let resolveOriginal!: (v: number) => void;

  const memo = computed(
    () =>
      new LazyPromise<number>((subscriber) => {
        log("produce");
        resolveOriginal = (v) => {
          subscriber.resolve(v);
        };
      }),
  );

  const proxy = memo();

  proxy.subscribe({
    resolve: (v) => {
      log("sub1", v);
    },
  });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "produce",
      ],
    ]
  `);

  resolveOriginal(10);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "sub1",
        10,
      ],
    ]
  `);

  // Second subscription after first settled: not in graph → no cache →
  // original re-subscribed
  proxy.subscribe({
    resolve: (v) => {
      log("sub2", v);
    },
  });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "produce",
      ],
    ]
  `);

  resolveOriginal(20);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "sub2",
        20,
      ],
    ]
  `);
});

test("computed: untracked - teardown", () => {
  const memo = computed(
    () =>
      new LazyPromise<number>(() => {
        log("produce");
        return () => {
          log("unsubscribe");
        };
      }),
  );

  const subscription1 = memo().subscribe();
  const subscription2 = memo().subscribe();

  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "produce",
      ],
    ]
  `);
  subscription1.unsubscribe();
  expect(readLog()).toMatchInlineSnapshot(`[]`);
  subscription2.unsubscribe();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "unsubscribe",
      ],
    ]
  `);
});

test("computed: unsubscribes from pending original when leaving dependency graph", () => {
  const memo = computed(
    () =>
      new LazyPromise<number>(() => () => {
        log("teardown");
      }),
  );

  const dispose = effect(() => memo().map(() => {}));

  expect(readLog()).toMatchInlineSnapshot(`[]`);

  // Removing the only subscriber → computed leaves graph → original unsubscribed
  dispose();

  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "teardown",
      ],
    ]
  `);
});

test("computed: does not hold cached result after leaving dependency graph", () => {
  let resolveOriginal!: (v: number) => void;

  const memo = computed(
    () =>
      new LazyPromise<number>((subscriber) => {
        log("produce");
        resolveOriginal = (v) => {
          subscriber.resolve(v);
        };
      }),
  );

  // Put memo into the graph and settle the original
  const dispose = effect(() => {
    memo().map((v) => {
      log("effect", v);
    });
  });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "produce",
      ],
    ]
  `);
  resolveOriginal(42);

  // Remove from graph: cache cleared
  dispose();

  // New untracked subscription must cause a fresh original subscription
  memo().subscribe({
    resolve: (v) => {
      log("late", v);
    },
  });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "produce",
      ],
    ]
  `);

  resolveOriginal(99);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "late",
        99,
      ],
    ]
  `);
});

test("computed: in dependency graph - cached result delivered immediately to late subscribers", () => {
  let resolveOriginal!: (v: number) => void;

  const memo = computed(
    () =>
      new LazyPromise<number>((subscriber) => {
        log("produce");
        resolveOriginal = (v) => {
          subscriber.resolve(v);
        };
      }),
  );

  // Put the computed into the graph and settle the original
  effect(() => {
    memo().map((v) => {
      log("effect", v);
    });
  });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "produce",
      ],
    ]
  `);

  resolveOriginal(7);

  // A late subscriber to the proxy gets the cached result
  memo().subscribe({
    resolve: (v) => {
      log("late", v);
    },
  });

  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "late",
        7,
      ],
    ]
  `);
});

//
// Auto-batching
//

test("signal writes stay stale until flush", () => {
  const a = signal(0);
  const doubled = computed(() => a() * 2);

  effect(() => {
    log("effect", doubled());
  });

  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "effect",
        0,
      ],
    ]
  `);

  a(1);
  expect([a(), doubled()]).toMatchInlineSnapshot(`
    [
      0,
      0,
    ]
  `);

  flush();

  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "effect",
        2,
      ],
    ]
  `);

  expect([a(), doubled()]).toMatchInlineSnapshot(`
    [
      1,
      2,
    ]
  `);
});

test("multiple writes to the same signal coalesce to the last value", () => {
  const a = signal(0);
  a(1);
  a(2);
  a(3);
  expect(a()).toBe(0);
  flush();
  expect(a()).toBe(3);
});

test("flush drains chained writes", () => {
  const a = signal(0);
  const b = signal(0);

  effect(() => {
    log("first", a());
    if (a() === 1) {
      b(1);
    }
  });

  effect(() => {
    log("second", b());
  });

  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "first",
        0,
      ],
      [
        "second",
        0,
      ],
    ]
  `);

  a(1);

  expect(readLog()).toMatchInlineSnapshot(`[]`);

  flush();

  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "first",
        1,
      ],
      [
        "second",
        1,
      ],
    ]
  `);
});

test("auto-flushes in a microtask when flush is not called", async () => {
  const a = signal(0);
  const doubled = computed(() => a() * 2);

  effect(() => {
    log("effect", doubled());
  });

  readLog(); // discard initial run

  a(1);
  expect([a(), doubled()]).toMatchInlineSnapshot(`
    [
      0,
      0,
    ]
  `);

  await Promise.resolve();

  expect([a(), doubled()]).toMatchInlineSnapshot(`
    [
      1,
      2,
    ]
  `);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "effect",
        2,
      ],
    ]
  `);
});

test("multiple writes before the microtask fires are batched into one flush", async () => {
  const a = signal(0);
  let runs = 0;

  effect(() => {
    runs++;
    a();
  });

  runs = 0;
  a(1);
  a(2);
  a(3);
  expect(a()).toBe(0);

  await Promise.resolve();

  expect(a()).toBe(3);
  expect(runs).toBe(1);
});

test("trigger defers effect re-run until auto-flush", async () => {
  const a = signal(0);

  effect(() => {
    log("effect", a());
  });

  readLog(); // discard initial run

  trigger(() => {
    a();
  });

  // effect has not re-run yet — deferred
  expect(readLog()).toMatchInlineSnapshot(`[]`);

  await Promise.resolve();

  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "effect",
        0,
      ],
    ]
  `);
});

test("writes inside auto-flush are processed in the same microtask", async () => {
  const a = signal(0);
  const b = signal(0);

  effect(() => {
    if (a() === 1) {
      b(1);
    }
  });

  effect(() => {
    log("b", b());
  });

  readLog(); // discard initial runs

  a(1);
  await Promise.resolve();

  expect(b()).toBe(1);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "b",
        1,
      ],
    ]
  `);
});

test("signal written inside effect during flush can be written again afterwards", async () => {
  const a = signal(0);
  const b = signal(0);
  let bRuns = 0;

  effect(() => {
    if (a() === 1) {
      b(1);
    }
  });

  effect(() => {
    bRuns++;
    b();
  });

  bRuns = 0;

  a(1);
  await Promise.resolve();

  expect(b()).toBe(1);
  expect(bRuns).toBe(1);

  // b was written inside an effect during the first flush; make sure it can still be
  // written and observed normally in subsequent flushes.
  bRuns = 0;
  b(2);
  await Promise.resolve();

  expect(b()).toBe(2);
  expect(bRuns).toBe(1);
});
