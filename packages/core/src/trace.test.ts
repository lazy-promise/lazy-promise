import type { Sink, Span, Subscription, Tracer } from "@lazy-promise/core";
import { box, LazyPromise, rejecting } from "@lazy-promise/core";
import { afterEach, beforeEach, expect, expectTypeOf, test } from "vitest";

const mockMicrotaskQueue: (() => void)[] = [];
const originalQueueMicrotask = queueMicrotask;
const logContents: unknown[][] = [];
let depth = 0;

const log = (...args: unknown[]) => {
  logContents.push(depth ? ["· ".repeat(depth).trimEnd(), ...args] : args);
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

class LogSpan implements Span<unknown> {
  constructor(public label: string) {}

  run(work: () => void, runDepth: number) {
    const previousDepth = depth;
    depth = runDepth;
    work();
    depth = previousDepth;
  }

  resolve(value: unknown) {
    log(this.label, "resolve", value);
  }

  reject(error: unknown) {
    log(this.label, "reject", error);
  }

  flatten() {
    log(this.label, "flatten");
  }

  unsubscribe() {
    log(this.label, "unsubscribe");
  }
}

class LogTracer implements Tracer<unknown, unknown> {
  constructor(public label: string) {}

  subscribe(dep: unknown) {
    log(this.label, "subscribe", dep);
    return new LogSpan(this.label);
  }
}

beforeEach(() => {
  global.queueMicrotask = (task) => mockMicrotaskQueue.push(task);
});

afterEach(() => {
  processMockMicrotaskQueue();
  global.queueMicrotask = originalQueueMicrotask;
  try {
    if (logContents.length) {
      throw new Error("Log expected to be empty at the end of each test.");
    }
    if (depth !== 0) {
      throw new Error("Depth expected to be 0 at the end of each test.");
    }
  } finally {
    logContents.length = 0;
    depth = 0;
  }
});

test("types", () => {
  new LazyPromise<number, { dep: null }>(() => {}).trace({
    subscribe: (dep, subscription) => {
      expectTypeOf(dep).toEqualTypeOf<{ dep: null }>();
      expectTypeOf(subscription).toEqualTypeOf<Subscription>();
      return {
        resolve: (value) => {
          expectTypeOf(value).toEqualTypeOf<number>();
        },
      };
    },
  });
  const tracer: Tracer<number> = { subscribe: () => {} };
  box(1).trace(tracer);
  // @ts-expect-error
  box("a").trace(tracer);
  expectTypeOf(box(1).trace(tracer).dispose).returns.toBeVoid();
});

test("resolve", () => {
  let sink: Sink<number>;
  const promise = new LazyPromise<number, string>((sinkLocal) => {
    sink = sinkLocal;
    log("produce");
  });
  promise.trace(new LogTracer("a"));
  promise.subscribe(
    {
      resolve: (value) => {
        log("consume", value);
      },
    },
    "dep",
  );
  sink!.resolve(1);
  sink!.resolve(2);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "a",
        "subscribe",
        "dep",
      ],
      [
        "·",
        "produce",
      ],
      [
        "a",
        "resolve",
        1,
      ],
      [
        "·",
        "consume",
        1,
      ],
    ]
  `);
});

test("reject", () => {
  const promise = rejecting("oops").pipe((promise) => {
    promise.trace(new LogTracer("a"));
    return promise;
  });
  promise.subscribe({
    reject: (error) => {
      log("consume", error);
    },
  });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "a",
        "subscribe",
        undefined,
      ],
      [
        "·",
        "a",
        "reject",
        "oops",
      ],
      [
        "· ·",
        "consume",
        "oops",
      ],
    ]
  `);
});

test("producer throws", () => {
  const promise = new LazyPromise<never>(() => {
    throw "oops";
  });
  promise.trace(new LogTracer("a"));
  promise.subscribe({
    reject: (error) => {
      log("consume", error);
    },
  });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "a",
        "subscribe",
        undefined,
      ],
      [
        "·",
        "a",
        "reject",
        "oops",
      ],
      [
        "· ·",
        "consume",
        "oops",
      ],
    ]
  `);
});

test("unsubscribe", () => {
  const promise = new LazyPromise<never>(() => () => {
    log("teardown");
  });
  promise.trace(new LogTracer("a"));
  const subscription = promise.subscribe();
  subscription.dispose();
  subscription.dispose();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "a",
        "subscribe",
        undefined,
      ],
      [
        "a",
        "unsubscribe",
      ],
      [
        "·",
        "teardown",
      ],
    ]
  `);
});

test("teardown when settling", () => {
  let sink: Sink<number>;
  const promise = new LazyPromise<number>((sinkLocal) => {
    sink = sinkLocal;
    return () => {
      log("teardown");
    };
  });
  promise.trace(new LogTracer("a"));
  promise.subscribe({
    resolve: (value) => {
      log("consume", value);
    },
  });
  sink!.resolve(1);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "a",
        "subscribe",
        undefined,
      ],
      [
        "a",
        "resolve",
        1,
      ],
      [
        "·",
        "teardown",
      ],
      [
        "·",
        "consume",
        1,
      ],
    ]
  `);
});

test("settling inside another span's run is logically nested", () => {
  const traced = box(1);
  traced.trace(new LogTracer("traced"));
  traced
    .map((value) => value + 1)
    .subscribe({
      resolve: (value) => {
        log("consume", value);
      },
    });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "traced",
        "subscribe",
        undefined,
      ],
      [
        "·",
        "traced",
        "resolve",
        1,
      ],
      [
        "· ·",
        "consume",
        2,
      ],
    ]
  `);

  traced
    .map(() => {
      throw "oops";
    })
    .subscribe({
      reject: (error) => {
        log("consume", error);
      },
    });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "traced",
        "subscribe",
        undefined,
      ],
      [
        "·",
        "traced",
        "resolve",
        1,
      ],
      [
        "· ·",
        "consume",
        "oops",
      ],
    ]
  `);
});

test("subscription is passed to the tracer", () => {
  let subscriptionInTracer: Subscription | undefined;
  const promise = box(1);
  promise.trace({
    subscribe: (dep, subscription) => {
      subscriptionInTracer = subscription;
    },
  });
  const subscription = promise.subscribe();
  expect(subscriptionInTracer).toBe(subscription);
});

test("multiple tracers", () => {
  const promise = box(1);
  promise.trace(new LogTracer("a"));
  promise.trace(new LogTracer("b"));
  promise.subscribe({
    resolve: (value) => {
      log("consume", value);
    },
  });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "b",
        "subscribe",
        undefined,
      ],
      [
        "·",
        "a",
        "subscribe",
        undefined,
      ],
      [
        "· ·",
        "a",
        "resolve",
        1,
      ],
      [
        "· · ·",
        "b",
        "resolve",
        1,
      ],
      [
        "· · · ·",
        "consume",
        1,
      ],
    ]
  `);
});

test("detach", () => {
  let sink: Sink<number>;
  const promise = new LazyPromise<number>((sinkLocal) => {
    sink = sinkLocal;
  });
  const tracingA = promise.trace(new LogTracer("a"));
  const tracingB = promise.trace(new LogTracer("b"));
  const tracingC = promise.trace(new LogTracer("c"));
  promise.subscribe();
  tracingB.dispose();
  tracingB.dispose();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "c",
        "subscribe",
        undefined,
      ],
      [
        "·",
        "b",
        "subscribe",
        undefined,
      ],
      [
        "· ·",
        "a",
        "subscribe",
        undefined,
      ],
    ]
  `);
  sink!.resolve(1);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "a",
        "resolve",
        1,
      ],
      [
        "·",
        "b",
        "resolve",
        1,
      ],
      [
        "· ·",
        "c",
        "resolve",
        1,
      ],
    ]
  `);
  const subscription = promise.subscribe();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "c",
        "subscribe",
        undefined,
      ],
      [
        "·",
        "a",
        "subscribe",
        undefined,
      ],
    ]
  `);
  tracingC.dispose();
  subscription.dispose();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "c",
        "unsubscribe",
      ],
      [
        "·",
        "a",
        "unsubscribe",
      ],
    ]
  `);
  tracingA.dispose();
  promise.subscribe();
  expect(readLog()).toMatchInlineSnapshot(`[]`);
});

test("span without run", () => {
  const promise = box(1);
  promise.trace({
    subscribe: () => ({
      resolve: (value) => {
        log("resolve", value);
      },
    }),
  });
  promise.trace(new LogTracer("a"));
  promise.subscribe({
    resolve: (value) => {
      log("consume", value);
    },
  });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "a",
        "subscribe",
        undefined,
      ],
      [
        "·",
        "resolve",
        1,
      ],
      [
        "·",
        "a",
        "resolve",
        1,
      ],
      [
        "· ·",
        "consume",
        1,
      ],
    ]
  `);
});

test("tracer that returns no span", () => {
  const promise = box(1);
  promise.trace({
    subscribe: (dep) => {
      log("subscribe", dep);
    },
  });
  promise.subscribe({
    resolve: (value) => {
      log("consume", value);
    },
  });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "subscribe",
        undefined,
      ],
      [
        "consume",
        1,
      ],
    ]
  `);
});

test("resolving with a LazyPromise", () => {
  const inner = box(1);
  inner.trace(new LogTracer("inner"));
  const outer = new LazyPromise<number>((sink) => {
    sink.resolve(inner);
  });
  outer.trace(new LogTracer("outer"));
  outer.subscribe({
    resolve: (value) => {
      log("consume", value);
    },
  });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "outer",
        "subscribe",
        undefined,
      ],
      [
        "·",
        "outer",
        "flatten",
      ],
      [
        "· ·",
        "inner",
        "subscribe",
        undefined,
      ],
      [
        "· · ·",
        "inner",
        "resolve",
        1,
      ],
      [
        "· · · ·",
        "outer",
        "resolve",
        1,
      ],
      [
        "· · · · ·",
        "consume",
        1,
      ],
    ]
  `);
});

test("resolving with a LazyPromise asynchronously", () => {
  let sink: Sink<number>;
  const inner = box(1);
  inner.trace(new LogTracer("inner"));
  const outer = new LazyPromise<number>((sinkLocal) => {
    sink = sinkLocal;
    return () => {
      log("teardown");
    };
  });
  outer.trace(new LogTracer("outer"));
  outer.subscribe({
    resolve: (value) => {
      log("consume", value);
    },
  });
  readLog();
  sink!.resolve(inner);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "outer",
        "flatten",
      ],
      [
        "·",
        "teardown",
      ],
      [
        "·",
        "inner",
        "subscribe",
        undefined,
      ],
      [
        "· ·",
        "inner",
        "resolve",
        1,
      ],
      [
        "· · ·",
        "outer",
        "resolve",
        1,
      ],
      [
        "· · · ·",
        "consume",
        1,
      ],
    ]
  `);
});

test("unsubscribing after resolving with a LazyPromise", () => {
  const inner = new LazyPromise<never>(() => () => {
    log("teardown");
  });
  inner.trace(new LogTracer("inner"));
  const outer = new LazyPromise<never>((sink) => {
    sink.resolve(inner);
  });
  outer.trace(new LogTracer("outer"));
  outer.subscribe().dispose();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "outer",
        "subscribe",
        undefined,
      ],
      [
        "·",
        "outer",
        "flatten",
      ],
      [
        "· ·",
        "inner",
        "subscribe",
        undefined,
      ],
      [
        "outer",
        "unsubscribe",
      ],
      [
        "·",
        "inner",
        "unsubscribe",
      ],
      [
        "· ·",
        "teardown",
      ],
    ]
  `);
});

test("nesting is preserved across the flattening loop", () => {
  // The inner producer runs after the consumer of `traced` has returned, but
  // logically inside it.
  const traced = box(1);
  traced.trace(new LogTracer("traced"));
  const inner = new LazyPromise<number>((sink) => {
    log("produce inner");
    sink.resolve(2);
  });
  inner.trace(new LogTracer("inner"));
  traced
    .map(() => inner)
    .subscribe({
      resolve: (value) => {
        log("consume", value);
      },
    });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "traced",
        "subscribe",
        undefined,
      ],
      [
        "·",
        "traced",
        "resolve",
        1,
      ],
      [
        "· ·",
        "inner",
        "subscribe",
        undefined,
      ],
      [
        "· · ·",
        "produce inner",
      ],
      [
        "· · ·",
        "inner",
        "resolve",
        2,
      ],
      [
        "· · · ·",
        "consume",
        2,
      ],
    ]
  `);
});

test("nesting is preserved across the flattening loop for untraced promises", () => {
  const traced = box(1);
  traced.trace(new LogTracer("traced"));
  const inner = box(2);
  inner.trace(new LogTracer("inner"));
  traced.map(() => box(undefined).map(() => inner)).subscribe();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "traced",
        "subscribe",
        undefined,
      ],
      [
        "·",
        "traced",
        "resolve",
        1,
      ],
      [
        "· ·",
        "inner",
        "subscribe",
        undefined,
      ],
      [
        "· · ·",
        "inner",
        "resolve",
        2,
      ],
    ]
  `);
});

test("flatten is only reported to the spans of the resolving promise", () => {
  const inner = box(1);
  inner.trace(new LogTracer("inner"));
  const mid = new LazyPromise<number>((sink) => {
    sink.resolve(inner);
  });
  mid.trace(new LogTracer("mid"));
  const outer = new LazyPromise<number>((sink) => {
    sink.resolve(mid);
  });
  outer.trace(new LogTracer("outer"));
  outer.subscribe({
    resolve: (value) => {
      log("consume", value);
    },
  });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "outer",
        "subscribe",
        undefined,
      ],
      [
        "·",
        "outer",
        "flatten",
      ],
      [
        "· ·",
        "mid",
        "subscribe",
        undefined,
      ],
      [
        "· · ·",
        "mid",
        "flatten",
      ],
      [
        "· · · ·",
        "inner",
        "subscribe",
        undefined,
      ],
      [
        "· · · · ·",
        "inner",
        "resolve",
        1,
      ],
      [
        "· · · · · ·",
        "mid",
        "resolve",
        1,
      ],
      [
        "· · · · · · ·",
        "outer",
        "resolve",
        1,
      ],
      [
        "· · · · · · · ·",
        "consume",
        1,
      ],
    ]
  `);
});

test("resolving with a LazyPromise traces like subscribing to it manually", () => {
  const getInner = () => {
    const inner = new LazyPromise<number>((sink) => {
      log("produce inner");
      sink.resolve(1);
      return () => {
        log("teardown inner");
      };
    });
    inner.trace(new LogTracer("inner"));
    return inner;
  };
  const manual = new LazyPromise<number>((sink) => getInner().subscribe(sink));
  manual.trace(new LogTracer("outer"));
  manual.subscribe({
    resolve: (value) => {
      log("consume", value);
    },
  });
  const manualLog = readLog();
  expect(manualLog).toMatchInlineSnapshot(`
    [
      [
        "outer",
        "subscribe",
        undefined,
      ],
      [
        "·",
        "inner",
        "subscribe",
        undefined,
      ],
      [
        "· ·",
        "produce inner",
      ],
      [
        "· ·",
        "inner",
        "resolve",
        1,
      ],
      [
        "· · ·",
        "teardown inner",
      ],
      [
        "· · ·",
        "outer",
        "resolve",
        1,
      ],
      [
        "· · · ·",
        "consume",
        1,
      ],
    ]
  `);

  const flattened = new LazyPromise<number>((sink) => {
    sink.resolve(getInner());
  });
  flattened.trace(new LogTracer("outer"));
  flattened.subscribe({
    resolve: (value) => {
      log("consume", value);
    },
  });
  const flattenedLog = readLog();
  expect(flattenedLog).toMatchInlineSnapshot(`
    [
      [
        "outer",
        "subscribe",
        undefined,
      ],
      [
        "·",
        "outer",
        "flatten",
      ],
      [
        "· ·",
        "inner",
        "subscribe",
        undefined,
      ],
      [
        "· · ·",
        "produce inner",
      ],
      [
        "· · ·",
        "inner",
        "resolve",
        1,
      ],
      [
        "· · · ·",
        "teardown inner",
      ],
      [
        "· · · ·",
        "outer",
        "resolve",
        1,
      ],
      [
        "· · · · ·",
        "consume",
        1,
      ],
    ]
  `);
  // Same as the manual log, except for the flatten entry and the extra dot it
  // adds to what follows.
  expect(
    flattenedLog
      .slice(2)
      .map(([dots, ...rest]) => [(dots as string).slice(2), ...rest]),
  ).toEqual(manualLog.slice(1));
});

test("unsubscribing after resolving with a LazyPromise traces like unsubscribing manually", () => {
  const getInner = () => {
    const inner = new LazyPromise<never>(() => () => {
      log("teardown inner");
    });
    inner.trace(new LogTracer("inner"));
    return inner;
  };
  const manual = new LazyPromise<never>((sink) => getInner().subscribe(sink));
  manual.trace(new LogTracer("outer"));
  manual.subscribe().dispose();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "outer",
        "subscribe",
        undefined,
      ],
      [
        "·",
        "inner",
        "subscribe",
        undefined,
      ],
      [
        "outer",
        "unsubscribe",
      ],
      [
        "·",
        "inner",
        "unsubscribe",
      ],
      [
        "· ·",
        "teardown inner",
      ],
    ]
  `);

  const flattened = new LazyPromise<never>((sink) => {
    sink.resolve(getInner());
  });
  flattened.trace(new LogTracer("outer"));
  flattened.subscribe().dispose();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "outer",
        "subscribe",
        undefined,
      ],
      [
        "·",
        "outer",
        "flatten",
      ],
      [
        "· ·",
        "inner",
        "subscribe",
        undefined,
      ],
      [
        "outer",
        "unsubscribe",
      ],
      [
        "·",
        "inner",
        "unsubscribe",
      ],
      [
        "· ·",
        "teardown inner",
      ],
    ]
  `);
});

test("run is called with the work in pieces when it is deferred", () => {
  // The consumer of `map` is caused by the resolve of `traced`, but can only
  // run once the producer of `map` has returned.
  const traced = box(1);
  traced.trace({
    subscribe: () => ({
      run: (work, depth) => {
        log("run", depth);
        work();
      },
    }),
  });
  traced
    .map((value) => value + 1)
    .subscribe({
      resolve: (value) => {
        log("consume", value);
      },
    });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "run",
        1,
      ],
      [
        "run",
        2,
      ],
      [
        "run",
        2,
      ],
      [
        "consume",
        2,
      ],
    ]
  `);
});

test("deep synchronous causality does not grow the stack", () => {
  const getMaxStackDepth = (stackDepth = 1): number => {
    try {
      return getMaxStackDepth(stackDepth + 1);
    } catch {
      return stackDepth;
    }
  };
  const count = getMaxStackDepth() + 10;
  let maxDepth = 0;
  const depthTracer: Tracer<unknown> = {
    subscribe: () => ({
      run: (work, runDepth) => {
        maxDepth = Math.max(maxDepth, runDepth);
        work();
      },
    }),
  };

  // A single traced promise in a recursion.
  const traced = box(undefined);
  traced.trace(depthTracer);
  const loop = (remaining: number): LazyPromise<string> =>
    traced.map(() => (remaining === 0 ? "value" : loop(remaining - 1)));
  loop(count).subscribe({
    resolve: (value) => {
      log("consume", value);
    },
  });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "consume",
        "value",
      ],
    ]
  `);
  expect(maxDepth).toBe(2 * count + 2);

  // Every promise in a flatten chain traced.
  maxDepth = 0;
  const getInner = (remaining: number): LazyPromise<string> => {
    const inner = new LazyPromise<string>((sink) => {
      sink.resolve(remaining === 0 ? "value" : getInner(remaining - 1));
    });
    inner.trace(depthTracer);
    return inner;
  };
  getInner(count).subscribe({
    resolve: (value) => {
      log("consume", value);
    },
  });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "consume",
        "value",
      ],
    ]
  `);
  // Two runs per level (producer, teardown), then the settle chain over all
  // the levels.
  expect(maxDepth).toBe(3 * count + 2);
  getInner(count).subscribe().dispose();
});
