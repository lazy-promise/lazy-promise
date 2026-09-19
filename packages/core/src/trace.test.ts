import type { Sink, Span, Subscription, Tracer } from "@lazy-promise/core";
import { box, LazyPromise } from "@lazy-promise/core";
import { afterEach, expect, expectTypeOf, test } from "vitest";

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

afterEach(() => {
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
