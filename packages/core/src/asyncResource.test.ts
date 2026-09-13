import type { Consumer, Sink } from "@lazy-promise/core";
import { fromGen, LazyPromise } from "@lazy-promise/core";
import { AsyncLocalStorage } from "node:async_hooks";
import { afterEach, expect, test, vi } from "vitest";

const als = new AsyncLocalStorage<string>();
const logContents: unknown[] = [];

/**
 * Logs the arguments along with the current async context.
 */
const log = (...args: unknown[]) => {
  logContents.push([...args, `context: ${als.getStore()}`]);
};

const readLog = () => {
  try {
    return [...logContents];
  } finally {
    logContents.length = 0;
  }
};

const logConsumer: Consumer<unknown> = {
  resolve: (value) => {
    log("resolve", value);
  },
  reject: (error) => {
    log("reject", error);
  },
};

/**
 * Resolves the sink in a microtask queued from inside the given context.
 */
const resolveLaterIn = (context: string, sink: Sink<number>, value: number) => {
  als.run(context, () => {
    queueMicrotask(() => {
      sink.resolve(value);
    });
  });
};

const flushMicrotasks = () => new Promise<void>(queueMicrotask);

/**
 * Loads a fresh copy of the package while `process` is patched, so that its
 * runtime detection sees the patched values.
 */
const importCoreWithProcessPatched = async (
  patch: Partial<Record<"versions" | "getBuiltinModule", unknown>>,
) => {
  const originalDescriptors = Object.entries(patch).map(
    ([key]) => [key, Object.getOwnPropertyDescriptor(process, key)!] as const,
  );
  for (const [key, value] of Object.entries(patch)) {
    Object.defineProperty(process, key, { value, configurable: true });
  }
  try {
    vi.resetModules();
    return await import("@lazy-promise/core");
  } finally {
    for (const [key, descriptor] of originalDescriptors) {
      Object.defineProperty(process, key, descriptor);
    }
  }
};

afterEach(() => {
  try {
    if (logContents.length) {
      throw new Error("Log expected to be empty at the end of each test.");
    }
  } finally {
    logContents.length = 0;
  }
});

test("consumer runs in the context of subscribe, not of the resolve call", async () => {
  const promise = new LazyPromise<number>((sink) => {
    log("produce");
    resolveLaterIn("producer", sink, 1);
  });
  als.run("subscriber", () => {
    promise.subscribe(logConsumer);
  });
  await flushMicrotasks();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "produce",
        "context: subscriber",
      ],
      [
        "resolve",
        1,
        "context: subscriber",
      ],
    ]
  `);
});

test("reject handler runs in the context of subscribe", async () => {
  const promise = new LazyPromise<number>((sink) => {
    als.run("producer", () => {
      queueMicrotask(() => {
        sink.reject("oops");
      });
    });
  });
  als.run("subscriber", () => {
    promise.subscribe(logConsumer);
  });
  await flushMicrotasks();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "reject",
        "oops",
        "context: subscriber",
      ],
    ]
  `);
});

test("a synchronous `run` around `sink.resolve` does not leak downstream", () => {
  const promise = new LazyPromise<number>((sink) => {
    als.run("producer", () => {
      sink.resolve(1);
    });
  });
  als.run("subscriber", () => {
    promise.subscribe(logConsumer);
  });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "resolve",
        1,
        "context: subscriber",
      ],
    ]
  `);
});

test("a producer reached through an asynchronous `sink.resolve(lazyPromise)` runs in the context of subscribe", async () => {
  const inner = new LazyPromise<number>((sink) => {
    log("produce inner");
    sink.resolve(1);
  });
  const outer = new LazyPromise<number>((sink) => {
    als.run("producer", () => {
      queueMicrotask(() => {
        sink.resolve(inner);
      });
    });
  });
  als.run("subscriber", () => {
    outer.subscribe(logConsumer);
  });
  await flushMicrotasks();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "produce inner",
        "context: subscriber",
      ],
      [
        "resolve",
        1,
        "context: subscriber",
      ],
    ]
  `);
});

test("teardown runs in the context of subscribe, not of the dispose call", () => {
  const promise = new LazyPromise<number>(() => () => {
    log("teardown");
  });
  const subscription = als.run("subscriber", () => promise.subscribe());
  als.run("disposer", () => {
    subscription.dispose();
  });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "teardown",
        "context: subscriber",
      ],
    ]
  `);
});

test("teardown runs in the context of subscribe when settling asynchronously", async () => {
  const promise = new LazyPromise<number>((sink) => {
    resolveLaterIn("producer", sink, 1);
    return () => {
      log("teardown");
    };
  });
  als.run("subscriber", () => {
    promise.subscribe(logConsumer);
  });
  await flushMicrotasks();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "teardown",
        "context: subscriber",
      ],
      [
        "resolve",
        1,
        "context: subscriber",
      ],
    ]
  `);
});

test("a producer subscribed by a downstream handler runs in the context of subscribe", async () => {
  const upstream = new LazyPromise<number>((sink) => {
    resolveLaterIn("producer", sink, 1);
  });
  const promise = upstream.map(
    () =>
      new LazyPromise<number>((sink) => {
        log("produce inner");
        sink.resolve(2);
      }),
  );
  als.run("subscriber", () => {
    promise.subscribe(logConsumer);
  });
  await flushMicrotasks();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "produce inner",
        "context: subscriber",
      ],
      [
        "resolve",
        2,
        "context: subscriber",
      ],
    ]
  `);
});

test("an empty context at subscribe time stays empty", async () => {
  const promise = new LazyPromise<number>((sink) => {
    resolveLaterIn("producer", sink, 1);
  });
  promise.subscribe(logConsumer);
  await flushMicrotasks();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "resolve",
        1,
        "context: undefined",
      ],
    ]
  `);
});

test("a generator continues in the context of subscribe", async () => {
  const upstream = new LazyPromise<number>((sink) => {
    resolveLaterIn("producer", sink, 1);
  });
  const promise = fromGen(function* () {
    log("before yield");
    const value = yield* upstream;
    log("after yield");
    return value;
  });
  als.run("subscriber", () => {
    promise.subscribe(logConsumer);
  });
  await flushMicrotasks();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "before yield",
        "context: subscriber",
      ],
      [
        "after yield",
        "context: subscriber",
      ],
      [
        "resolve",
        1,
        "context: subscriber",
      ],
    ]
  `);
});

test("the context set up by a span's `run` wins over the restored one", async () => {
  const promise = new LazyPromise<number>((sink) => {
    resolveLaterIn("producer", sink, 1);
  });
  promise.trace({
    subscribe: () => ({
      run: (work) => {
        als.run("span", work);
      },
    }),
  });
  als.run("subscriber", () => {
    promise.subscribe(logConsumer);
  });
  await flushMicrotasks();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "resolve",
        1,
        "context: span",
      ],
    ]
  `);
});

test("in a browser-like runtime, handlers run in the context of the settle call", async () => {
  // Shape of the `process` polyfill that bundlers provide for browsers.
  const core = await importCoreWithProcessPatched({ versions: {} });
  const promise = new core.LazyPromise<number>((sink) => {
    als.run("producer", () => {
      queueMicrotask(() => {
        sink.resolve(core.box(1));
      });
    });
  });
  als.run("subscriber", () => {
    promise.subscribe(logConsumer);
  });
  await flushMicrotasks();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "resolve",
        1,
        "context: producer",
      ],
    ]
  `);
});

test("in a browser-like runtime, the reject handler runs in the context of the reject call", async () => {
  const core = await importCoreWithProcessPatched({ versions: {} });
  const promise = new core.LazyPromise<number>((sink) => {
    als.run("producer", () => {
      queueMicrotask(() => {
        sink.reject("oops");
      });
    });
  });
  als.run("subscriber", () => {
    promise.subscribe(logConsumer);
  });
  await flushMicrotasks();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "reject",
        "oops",
        "context: producer",
      ],
    ]
  `);
});

test("in a browser-like runtime, teardown runs in the context of the dispose call", async () => {
  const core = await importCoreWithProcessPatched({ versions: {} });
  const promise = new core.LazyPromise<number>(() => () => {
    log("teardown");
  });
  const subscription = als.run("subscriber", () => promise.subscribe());
  als.run("disposer", () => {
    subscription.dispose();
  });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "teardown",
        "context: disposer",
      ],
    ]
  `);
});

test("in a Node-like runtime without process.getBuiltinModule, importing throws", async () => {
  await expect(
    importCoreWithProcessPatched({ getBuiltinModule: undefined }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(
    `[Error: LazyPromise needs process.getBuiltinModule to propagate AsyncLocalStorage context. Upgrade to Node.js 20.16+ / 22.3+ (or an equivalent runtime).]`,
  );
});

test("in a runtime whose process.getBuiltinModule does not know node:async_hooks, handlers run in the context of the settle call", async () => {
  const core = await importCoreWithProcessPatched({
    getBuiltinModule: () => undefined,
  });
  const promise = new core.LazyPromise<number>((sink) => {
    als.run("producer", () => {
      queueMicrotask(() => {
        sink.resolve(1);
      });
    });
  });
  als.run("subscriber", () => {
    promise.subscribe(logConsumer);
  });
  await flushMicrotasks();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "resolve",
        1,
        "context: producer",
      ],
    ]
  `);
});
