import type { Sink, Span, Subscription, Tracer } from "@lazy-promise/core";
import { box, LazyPromise, rejecting } from "@lazy-promise/core";
import { afterEach, beforeEach, expect, expectTypeOf, test } from "vitest";

const mockMicrotaskQueue: (() => void)[] = [];
const originalQueueMicrotask = queueMicrotask;
const logContents: unknown[] = [];
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

  run(work: () => void) {
    depth++;
    try {
      work();
    } finally {
      depth--;
    }
  }

  resolve(value: unknown) {
    log(this.label, "resolve", value);
  }

  reject(error: unknown) {
    log(this.label, "reject", error);
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
        "b",
        "subscribe",
        undefined,
      ],
      [
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

test("errors thrown by tracer", () => {
  const promise = new LazyPromise<never>(() => () => {
    log("teardown");
  });
  promise.trace({
    subscribe: () => {
      throw "subscribe error";
    },
  });
  promise.trace({
    subscribe: () => ({
      run: () => {
        throw "run error";
      },
      unsubscribe: () => {
        throw "unsubscribe error";
      },
    }),
  });
  promise.subscribe().dispose();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "teardown",
      ],
    ]
  `);
  expect(mockMicrotaskQueue.length).toBe(4);
  expect(processMockMicrotaskQueue).toThrow("subscribe error");
  expect(processMockMicrotaskQueue).toThrow("run error");
  expect(processMockMicrotaskQueue).toThrow("unsubscribe error");
  expect(processMockMicrotaskQueue).toThrow("run error");
});

test("errors thrown by tracer when settling", () => {
  const throwingSpan: Span<unknown> = {
    run: (work) => {
      work();
      throw "run error";
    },
    resolve: () => {
      throw "resolve error";
    },
    reject: () => {
      throw "reject error";
    },
  };
  const inner = box(1);
  inner.trace({ subscribe: () => throwingSpan });
  const outer = new LazyPromise<number>((sink) => {
    sink.resolve(inner);
  });
  outer.trace({ subscribe: () => throwingSpan });
  outer.subscribe({
    resolve: (value) => {
      log("consume", value);
    },
  });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "consume",
        1,
      ],
    ]
  `);
  // Producer run of outer, then, nested: resolve of inner, resolve of outer,
  // and the four remaining runs unwinding.
  expect(mockMicrotaskQueue.length).toBe(7);
  expect(processMockMicrotaskQueue).toThrow("run error");
  expect(processMockMicrotaskQueue).toThrow("resolve error");
  expect(processMockMicrotaskQueue).toThrow("resolve error");
  expect(processMockMicrotaskQueue).toThrow("run error");
  expect(processMockMicrotaskQueue).toThrow("run error");
  expect(processMockMicrotaskQueue).toThrow("run error");
  expect(processMockMicrotaskQueue).toThrow("run error");

  rejecting("oops")
    .pipe((promise) => {
      promise.trace({ subscribe: () => throwingSpan });
      return promise;
    })
    .subscribe({
      reject: (error) => {
        log("consume", error);
      },
    });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "consume",
        "oops",
      ],
    ]
  `);
  expect(mockMicrotaskQueue.length).toBe(3);
  expect(processMockMicrotaskQueue).toThrow("reject error");
  expect(processMockMicrotaskQueue).toThrow("run error");
  expect(processMockMicrotaskQueue).toThrow("run error");
});

test("work is run exactly once", () => {
  const promise = new LazyPromise<number>((sink) => {
    log("produce");
    sink.resolve(1);
  });
  promise.trace({
    subscribe: () => ({
      run: (work) => {
        work();
        work();
      },
    }),
  });
  promise.subscribe({
    resolve: (value) => {
      log("consume", value);
    },
  });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "produce",
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
