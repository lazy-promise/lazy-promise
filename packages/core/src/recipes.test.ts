import type { Consumer, NotAnErrorBox, Subscription } from "@lazy-promise/core";
import {
  all,
  box,
  defer,
  ErrorBox,
  fromEager,
  fromGen,
  inMessageChannel,
  inTimeout,
  LazyPromise,
  never,
  race,
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

// Awaits a real macrotask, so this drains microtask chains of any length.
const flushMicrotasks = () => vi.advanceTimersByTimeAsync(0);

const logConsumer: Consumer<any> = {
  resolve: (value) => {
    log("handleValue", value);
  },
  reject: (error) => {
    log("handleError", error);
  },
};

/**
 * A LazyPromise that logs when it's subscribed and unsubscribed, and settles
 * when you tell it to.
 */
const createRemote = <Value>(label: string) => {
  const consumers = new Map<string, Consumer<Value>>();
  let counter = 0;
  const remote = new LazyPromise<Value>((sink) => {
    const id = `${label}${counter++}`;
    log("produce", id);
    consumers.set(id, sink);
    return () => {
      log("dispose", id);
      consumers.delete(id);
    };
  });
  const resolve = (id: string, value: Value) => {
    consumers.get(id)!.resolve!(value);
  };
  const reject = (id: string, error: unknown) => {
    consumers.get(id)!.reject!(error);
  };
  return { remote, resolve, reject };
};

beforeEach(() => {
  vi.useFakeTimers();
  logTime = Date.now();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  try {
    if (logContents.length) {
      throw new Error("Log expected to be empty at the end of each test.");
    }
  } finally {
    logContents.length = 0;
  }
});

//
// Usage with EventTarget API
//

export const listen = <DispatchedEvent extends Event = Event>(
  target: EventTarget,
  type: string,
  listener: (event: DispatchedEvent) => void,
  options?: AddEventListenerOptions,
) => {
  target.addEventListener(type, listener as EventListener, options);
  return () => {
    target.removeEventListener(type, listener as EventListener, options);
  };
};

// A stand-in for WebSocket that works in Node.
class Socket extends EventTarget {}

// The docs snippets, with `socket` and `id` parametrized.
const opened = (socket: Socket) =>
  new LazyPromise<void>((sink) =>
    listen(socket, "open", () => {
      sink.resolve();
    }),
  );

const reply = (socket: Socket, id: number) =>
  new LazyPromise<MessageEvent>((sink) =>
    listen<MessageEvent>(socket, "message", (event) => {
      if (JSON.parse(event.data).id === id) {
        sink.resolve(event);
      }
    }),
  );

//
// Timing out
//

// The docs snippet, with `source` and `ms` parametrized.
export const withTimeout =
  (ms: number) =>
  <Value, Dep>(source: LazyPromise<Value, Dep>) =>
    race([
      source,
      inTimeout(ms).map(() => {
        throw new Error(`Timed out.`);
      }),
    ]);

//
// Exponential backoff
//

// The docs snippet, with `source` parametrized and delays 10x shorter.
const withBackoff = <Value>(source: LazyPromise<Value>) =>
  fromGen(function* () {
    for (let attempt = 1; ; attempt++) {
      try {
        return yield* source;
      } catch (error) {
        if (attempt === 3) {
          throw error;
        }
      }
      yield* inTimeout(100 * 2 ** (attempt - 1));
    }
  });

//
// Limiting concurrency
//

export const createConcurrencyLimit = (concurrent: number) => {
  let running = 0;
  // Subscriptions waiting for a slot.
  const queue: (() => void)[] = [];

  return <Value, Dep>(source: LazyPromise<Value, Dep>) =>
    new LazyPromise<Value, Dep>((sink, dep) => {
      let subscription: Subscription | undefined;

      const start = () => {
        running++;
        subscription = source.subscribe<any>(sink, dep);
      };

      if (running < concurrent) {
        start();
      } else {
        queue.push(start);
      }

      // Runs both when the source settles and when the subscription is
      // disposed.
      return () => {
        const index = queue.indexOf(start);
        if (index !== -1) {
          queue.splice(index, 1);
          return;
        }
        // Still undefined if the source settled synchronously while being
        // started from the queue, in which case there's nothing to dispose.
        subscription?.dispose();
        running--;
        queue.shift()?.();
      };
    });
};

//
// Periodically yielding to the event loop
//

let deadline = 0;

const maybeYield = defer(() => {
  if (performance.now() < deadline) {
    return;
  }
  return inMessageChannel().map(() => {
    deadline = performance.now() + 5;
  });
});

// The docs snippet, with `items` and the work parametrized.
const createLongRunningTask = (
  items: number[],
  doWork: (item: number) => void,
) =>
  fromGen(function* () {
    for (const item of items) {
      doWork(item);
      yield* maybeYield;
    }
  });

//
// Rate-limiting
//

export const createRateLimit = (count: number, intervalMs: number) => {
  // Start times in the last `intervalMs`, including scheduled ones, oldest
  // first.
  const startTimes: number[] = [];

  return <Value, Dep>(source: LazyPromise<Value, Dep>) =>
    new LazyPromise<Value, Dep>((sink, dep) => {
      const now = Date.now();
      while ((startTimes[0] ?? Infinity) <= now - intervalMs) {
        startTimes.shift();
      }
      const startTime = Math.max(
        now,
        (startTimes.at(-count) ?? -Infinity) + intervalMs,
      );
      startTimes.push(startTime);
      // To fail instead of waiting, check `startTime > now` here.
      const subscription = (
        startTime > now ? inTimeout(startTime - now).map(() => source) : source
      ).subscribe<any>(sink, dep);
      return () => {
        subscription.dispose();
        // Disposed while waiting: give the slot back.
        if (startTime > Date.now()) {
          startTimes.splice(startTimes.indexOf(startTime), 1);
        }
      };
    });
};

//
// Token refresh on 401
//

// The docs snippet, with the fetch injectable for tests.
const createAuth = (fetchRefreshToken: () => Promise<void>) => {
  let refreshing: Promise<void> | undefined;
  let refreshCount = 0;

  // Shared between concurrent callers, so it's deliberately not cancellable.
  const refreshToken = fromEager(async () => {
    refreshing ??= fetchRefreshToken().then(() => {
      refreshCount++;
    });
    try {
      await refreshing;
    } finally {
      refreshing = undefined;
    }
  });

  const withAuth = <Value, Dep>(source: LazyPromise<Value, Dep>) =>
    defer(() => {
      const localRefreshCount = refreshCount;
      return source.catchBoxed((error) =>
        error === "unauthorized"
          ? (refreshCount === localRefreshCount ? refreshToken : box()).map(
              () => source,
            )
          : new ErrorBox(error),
      );
    });

  return withAuth;
};

//
// Teardown functions instead of subscription objects
//

// The docs snippet.
const toDisposeFn = (source: LazyPromise<NotAnErrorBox, undefined>) => {
  const subscription = source.subscribe();
  return () => {
    subscription.dispose();
  };
};

test("types", () => {
  () => {
    expectTypeOf(
      listen(window, "resize", (event) => {
        expectTypeOf(event).toEqualTypeOf<Event>();
      }),
    ).toEqualTypeOf<() => void>();
    listen<MessageEvent>(new WebSocket(""), "message", (event) => {
      expectTypeOf(event).toEqualTypeOf<MessageEvent>();
    });
    // @ts-expect-error The listener's parameter must accept the event type.
    listen<MessageEvent>(new WebSocket(""), "message", (event: MouseEvent) => {
      expectTypeOf(event).toEqualTypeOf<MouseEvent>();
    });
  };

  expectTypeOf(opened(new Socket())).toEqualTypeOf<LazyPromise<void>>();
  expectTypeOf(reply(new Socket(), 1)).toEqualTypeOf<
    LazyPromise<MessageEvent>
  >();

  expectTypeOf(
    new LazyPromise<number | ErrorBox<"oops">, { a: null }>(() => {}).pipe(
      withTimeout(1000),
    ),
  ).toEqualTypeOf<LazyPromise<number | ErrorBox<"oops">, { a: null }>>();

  // The variant with a boxed error mentioned in the docs.
  expectTypeOf(
    race([
      new LazyPromise<number, { a: null }>(() => {}),
      inTimeout(1000).map(() => new ErrorBox("timeout")),
    ]),
  ).toEqualTypeOf<LazyPromise<number | ErrorBox<"timeout">, { a: null }>>();

  expectTypeOf(
    new LazyPromise<number | ErrorBox<"oops">>(() => {}).pipe(withBackoff),
  ).toEqualTypeOf<LazyPromise<number | ErrorBox<"oops">>>();

  expectTypeOf(
    new LazyPromise<number>(() => {}).pipe(toDisposeFn),
  ).toEqualTypeOf<() => void>();
  new LazyPromise<number, undefined>(() => {}).pipe(toDisposeFn);
  // @ts-expect-error Unhandled boxed errors.
  new LazyPromise<number | ErrorBox<"oops">>(() => {}).pipe(toDisposeFn);
  // @ts-expect-error Unsatisfied dependency.
  new LazyPromise<number, { a: null }>(() => {}).pipe(toDisposeFn);

  const concurrencyLimit = createConcurrencyLimit(2);
  expectTypeOf(
    new LazyPromise<number | ErrorBox<"oops">, { a: null }>(() => {}).pipe(
      concurrencyLimit,
    ),
  ).toEqualTypeOf<LazyPromise<number | ErrorBox<"oops">, { a: null }>>();

  expectTypeOf(createLongRunningTask([], () => {})).toEqualTypeOf<
    LazyPromise<void>
  >();

  const rateLimit = createRateLimit(2, 1000);
  expectTypeOf(
    new LazyPromise<number | ErrorBox<"oops">, { a: null }>(() => {}).pipe(
      rateLimit,
    ),
  ).toEqualTypeOf<LazyPromise<number | ErrorBox<"oops">, { a: null }>>();

  const withAuth = createAuth(() => Promise.resolve());
  expectTypeOf(
    new LazyPromise<
      number | ErrorBox<"unauthorized" | "not-found">,
      { a: null }
    >(() => {}).pipe(withAuth),
  ).toEqualTypeOf<
    LazyPromise<number | ErrorBox<"unauthorized" | "not-found">, { a: null }>
  >();
});

//
// Usage with EventTarget API
//

test("listen: adds a listener and returns a teardown", () => {
  const socket = new Socket();
  const dispose = listen(socket, "open", (event) => {
    log("open", event.type);
  });
  socket.dispatchEvent(new Event("open"));
  socket.dispatchEvent(new Event("open"));
  dispose();
  socket.dispatchEvent(new Event("open"));
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "open",
        "open",
      ],
      [
        "open",
        "open",
      ],
    ]
  `);
});

test("opened: resolves on the first event and removes the listener", () => {
  const socket = new Socket();
  opened(socket).subscribe(logConsumer);
  socket.dispatchEvent(new Event("message"));
  expect(readLog()).toMatchInlineSnapshot(`[]`);
  socket.dispatchEvent(new Event("open"));
  socket.dispatchEvent(new Event("open"));
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleValue",
        undefined,
      ],
    ]
  `);
});

test("opened: dispose removes the listener", () => {
  const socket = new Socket();
  opened(socket).subscribe(logConsumer).dispose();
  socket.dispatchEvent(new Event("open"));
  expect(readLog()).toMatchInlineSnapshot(`[]`);
});

test("reply: resolves on the first matching event", () => {
  const socket = new Socket();
  reply(socket, 2).subscribe({
    resolve: (event) => {
      log("handleValue", event.data);
    },
  });
  socket.dispatchEvent(new MessageEvent("message", { data: `{"id":1}` }));
  expect(readLog()).toMatchInlineSnapshot(`[]`);
  socket.dispatchEvent(new MessageEvent("message", { data: `{"id":2}` }));
  socket.dispatchEvent(new MessageEvent("message", { data: `{"id":2}` }));
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleValue",
        "{"id":2}",
      ],
    ]
  `);
});

//
// Timing out
//

test("withTimeout: source settles in time", () => {
  const { remote, resolve } = createRemote<string>("a");
  remote.pipe(withTimeout(1000)).subscribe(logConsumer);
  vi.advanceTimersByTime(999);
  resolve("a0", "value");
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "produce",
        "a0",
      ],
      "999 ms passed",
      [
        "dispose",
        "a0",
      ],
      [
        "handleValue",
        "value",
      ],
    ]
  `);
  expect(vi.getTimerCount()).toBe(0);
});

test("withTimeout: source times out", () => {
  const { remote } = createRemote<string>("a");
  remote.pipe(withTimeout(1000)).subscribe(logConsumer);
  vi.advanceTimersByTime(1000);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "produce",
        "a0",
      ],
      "1000 ms passed",
      [
        "dispose",
        "a0",
      ],
      [
        "handleError",
        [Error: Timed out.],
      ],
    ]
  `);
});

test("withTimeout: dispose", () => {
  const { remote } = createRemote<string>("a");
  const subscription = remote.pipe(withTimeout(1000)).subscribe(logConsumer);
  subscription.dispose();
  expect(vi.getTimerCount()).toBe(0);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "produce",
        "a0",
      ],
      [
        "dispose",
        "a0",
      ],
    ]
  `);
});

//
// Exponential backoff
//

test("withBackoff: succeeds after retries", () => {
  const { remote, resolve, reject } = createRemote<string>("a");
  remote.pipe(withBackoff).subscribe(logConsumer);
  reject("a0", "error 0");
  vi.advanceTimersByTime(100);
  reject("a1", "error 1");
  vi.advanceTimersByTime(200);
  resolve("a2", "value");
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "produce",
        "a0",
      ],
      [
        "dispose",
        "a0",
      ],
      "100 ms passed",
      [
        "produce",
        "a1",
      ],
      [
        "dispose",
        "a1",
      ],
      "200 ms passed",
      [
        "produce",
        "a2",
      ],
      [
        "dispose",
        "a2",
      ],
      [
        "handleValue",
        "value",
      ],
    ]
  `);
});

test("withBackoff: runs out of retries", () => {
  const { remote, reject } = createRemote<string>("a");
  remote.pipe(withBackoff).subscribe(logConsumer);
  reject("a0", "error 0");
  vi.advanceTimersByTime(100);
  reject("a1", "error 1");
  vi.advanceTimersByTime(200);
  reject("a2", "error 2");
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "produce",
        "a0",
      ],
      [
        "dispose",
        "a0",
      ],
      "100 ms passed",
      [
        "produce",
        "a1",
      ],
      [
        "dispose",
        "a1",
      ],
      "200 ms passed",
      [
        "produce",
        "a2",
      ],
      [
        "dispose",
        "a2",
      ],
      [
        "handleError",
        "error 2",
      ],
    ]
  `);
  expect(vi.getTimerCount()).toBe(0);
});

test("withBackoff: does not retry boxed errors", () => {
  box(new ErrorBox("oops"))
    .pipe(withBackoff)
    .subscribe<any>({
      resolve: (value) => {
        log("handleValue", value);
      },
    });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleValue",
        ErrorBox {
          "error": "oops",
        },
      ],
    ]
  `);
  expect(vi.getTimerCount()).toBe(0);
});

test("withBackoff: dispose while waiting to retry", () => {
  const { remote, reject } = createRemote<string>("a");
  const subscription = remote.pipe(withBackoff).subscribe(logConsumer);
  reject("a0", "error 0");
  vi.advanceTimersByTime(50);
  subscription.dispose();
  expect(vi.getTimerCount()).toBe(0);
  vi.advanceTimersByTime(1000);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "produce",
        "a0",
      ],
      [
        "dispose",
        "a0",
      ],
    ]
  `);
});

//
// Limiting concurrency
//

test("createConcurrencyLimit: all", () => {
  const concurrencyLimit = createConcurrencyLimit(2);
  const { remote, resolve } = createRemote<string>("a");
  all([remote, remote, remote, remote].map(concurrencyLimit)).subscribe(
    logConsumer,
  );
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "produce",
        "a0",
      ],
      [
        "produce",
        "a1",
      ],
    ]
  `);
  resolve("a1", "value 1");
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "dispose",
        "a1",
      ],
      [
        "produce",
        "a2",
      ],
    ]
  `);
  resolve("a0", "value 0");
  resolve("a2", "value 2");
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "dispose",
        "a0",
      ],
      [
        "produce",
        "a3",
      ],
      [
        "dispose",
        "a2",
      ],
    ]
  `);
  resolve("a3", "value 3");
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "dispose",
        "a3",
      ],
      [
        "handleValue",
        [
          "value 0",
          "value 1",
          "value 2",
          "value 3",
        ],
      ],
    ]
  `);
});

test("createConcurrencyLimit: the limit is shared between subscriptions", () => {
  const concurrencyLimit = createConcurrencyLimit(1);
  const { remote, resolve } = createRemote<string>("a");
  const limited = remote.pipe(concurrencyLimit);
  limited.subscribe(logConsumer);
  limited.subscribe(logConsumer);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "produce",
        "a0",
      ],
    ]
  `);
  resolve("a0", "value 0");
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "dispose",
        "a0",
      ],
      [
        "produce",
        "a1",
      ],
      [
        "handleValue",
        "value 0",
      ],
    ]
  `);
  resolve("a1", "value 1");
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "dispose",
        "a1",
      ],
      [
        "handleValue",
        "value 1",
      ],
    ]
  `);
});

test("createConcurrencyLimit: rejection frees up a slot", () => {
  const concurrencyLimit = createConcurrencyLimit(1);
  const { remote, reject } = createRemote<string>("a");
  const limited = remote.pipe(concurrencyLimit);
  limited.subscribe(logConsumer);
  limited.subscribe(logConsumer);
  reject("a0", "oops");
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "produce",
        "a0",
      ],
      [
        "dispose",
        "a0",
      ],
      [
        "produce",
        "a1",
      ],
      [
        "handleError",
        "oops",
      ],
    ]
  `);
});

test("createConcurrencyLimit: dispose while running frees up a slot", () => {
  const concurrencyLimit = createConcurrencyLimit(1);
  const { remote } = createRemote<string>("a");
  const limited = remote.pipe(concurrencyLimit);
  const subscription = limited.subscribe(logConsumer);
  limited.subscribe(logConsumer);
  subscription.dispose();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "produce",
        "a0",
      ],
      [
        "dispose",
        "a0",
      ],
      [
        "produce",
        "a1",
      ],
    ]
  `);
});

test("createConcurrencyLimit: dispose while queued", () => {
  const concurrencyLimit = createConcurrencyLimit(1);
  const { remote, resolve } = createRemote<string>("a");
  const limited = remote.pipe(concurrencyLimit);
  limited.subscribe(logConsumer);
  const queuedSubscription = limited.subscribe(logConsumer);
  limited.subscribe(logConsumer);
  queuedSubscription.dispose();
  resolve("a0", "value 0");
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "produce",
        "a0",
      ],
      [
        "dispose",
        "a0",
      ],
      [
        "produce",
        "a1",
      ],
      [
        "handleValue",
        "value 0",
      ],
    ]
  `);
  resolve("a1", "value 1");
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "dispose",
        "a1",
      ],
      [
        "handleValue",
        "value 1",
      ],
    ]
  `);
});

test("createConcurrencyLimit: dispose queued in the middle and at the end", () => {
  const concurrencyLimit = createConcurrencyLimit(1);
  const { remote, resolve } = createRemote<string>("a");
  const limited = remote.pipe(concurrencyLimit);
  limited.subscribe(logConsumer);
  limited.subscribe(logConsumer);
  const middleSubscription = limited.subscribe(logConsumer);
  const lastSubscription = limited.subscribe(logConsumer);
  lastSubscription.dispose();
  middleSubscription.dispose();
  resolve("a0", "value 0");
  resolve("a1", "value 1");
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "produce",
        "a0",
      ],
      [
        "dispose",
        "a0",
      ],
      [
        "produce",
        "a1",
      ],
      [
        "handleValue",
        "value 0",
      ],
      [
        "dispose",
        "a1",
      ],
      [
        "handleValue",
        "value 1",
      ],
    ]
  `);
  // The queue is empty again and still works.
  limited.subscribe(logConsumer);
  limited.subscribe(logConsumer);
  resolve("a2", "value 2");
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "produce",
        "a2",
      ],
      [
        "dispose",
        "a2",
      ],
      [
        "produce",
        "a3",
      ],
      [
        "handleValue",
        "value 2",
      ],
    ]
  `);
  resolve("a3", "value 3");
  readLog();
});

test("createConcurrencyLimit: queued sources that settle synchronously", () => {
  const concurrencyLimit = createConcurrencyLimit(1);
  const { remote, resolve } = createRemote<string>("a");
  remote.pipe(concurrencyLimit).subscribe(logConsumer);
  box("sync value").pipe(concurrencyLimit).subscribe(logConsumer);
  rejecting("sync error").pipe(concurrencyLimit).subscribe(logConsumer);
  remote.pipe(concurrencyLimit).subscribe(logConsumer);
  resolve("a0", "value 0");
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "produce",
        "a0",
      ],
      [
        "dispose",
        "a0",
      ],
      [
        "produce",
        "a1",
      ],
      [
        "handleError",
        "sync error",
      ],
      [
        "handleValue",
        "sync value",
      ],
      [
        "handleValue",
        "value 0",
      ],
    ]
  `);
  resolve("a1", "value 1");
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "dispose",
        "a1",
      ],
      [
        "handleValue",
        "value 1",
      ],
    ]
  `);
});

test("createConcurrencyLimit: passes the dependency through", () => {
  const concurrencyLimit = createConcurrencyLimit(1);
  new LazyPromise<void, string>((sink, dep) => {
    log("dep", dep);
    sink.resolve();
  })
    .pipe(concurrencyLimit)
    .subscribe(logConsumer, "dep value");
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "dep",
        "dep value",
      ],
      [
        "handleValue",
        undefined,
      ],
    ]
  `);
});

test("createConcurrencyLimit: never-settling source keeps the slot", () => {
  const concurrencyLimit = createConcurrencyLimit(1);
  never.pipe(concurrencyLimit).subscribe(logConsumer);
  box("value").pipe(concurrencyLimit).subscribe(logConsumer);
  expect(readLog()).toMatchInlineSnapshot(`[]`);
});

//
// Periodically yielding to the event loop
//

test("longRunningTask: yields first, then once the deadline has passed", async () => {
  let now = 100;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  // Items processed synchronously between yields.
  const batches: number[][] = [];
  let batch: number[] = [];
  await createLongRunningTask([1, 2, 3, 4], (item) => {
    now += 3;
    if (!batch.length) {
      queueMicrotask(() => {
        batches.push(batch);
        batch = [];
      });
    }
    batch.push(item);
  }).toEager();
  expect(batches).toEqual([[1], [2, 3], [4]]);
});

test("longRunningTask: dispose stops the work", async () => {
  vi.useRealTimers();
  const processed: number[] = [];
  createLongRunningTask([1, 2], (item) => {
    processed.push(item);
  })
    .subscribe(logConsumer)
    .dispose();
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(processed).toEqual([1]);
});

//
// Rate-limiting
//

test("createRateLimit: many subscriptions at once start in batches", () => {
  const rateLimit = createRateLimit(2, 1000);
  const { remote } = createRemote<string>("a");
  const limited = remote.pipe(rateLimit);
  for (let index = 0; index < 6; index++) {
    limited.subscribe(logConsumer);
  }
  vi.advanceTimersByTime(2000);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "produce",
        "a0",
      ],
      [
        "produce",
        "a1",
      ],
      "1000 ms passed",
      [
        "produce",
        "a2",
      ],
      [
        "produce",
        "a3",
      ],
      "1000 ms passed",
      [
        "produce",
        "a4",
      ],
      [
        "produce",
        "a5",
      ],
    ]
  `);
});

test("createRateLimit: delays subscriptions over the limit", () => {
  const rateLimit = createRateLimit(2, 1000);
  const { remote, resolve } = createRemote<string>("a");
  const limited = remote.pipe(rateLimit);
  limited.subscribe(logConsumer);
  vi.advanceTimersByTime(300);
  limited.subscribe(logConsumer);
  limited.subscribe(logConsumer);
  limited.subscribe(logConsumer);
  resolve("a0", "value 0");
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "produce",
        "a0",
      ],
      "300 ms passed",
      [
        "produce",
        "a1",
      ],
      [
        "dispose",
        "a0",
      ],
      [
        "handleValue",
        "value 0",
      ],
    ]
  `);
  vi.advanceTimersByTime(700);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "700 ms passed",
      [
        "produce",
        "a2",
      ],
    ]
  `);
  vi.advanceTimersByTime(300);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "300 ms passed",
      [
        "produce",
        "a3",
      ],
    ]
  `);
  // The limit is shared between sources.
  box("sync").pipe(rateLimit).subscribe(logConsumer);
  vi.advanceTimersByTime(700);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "700 ms passed",
      [
        "handleValue",
        "sync",
      ],
    ]
  `);
});

test("createRateLimit: dispose while waiting", () => {
  const rateLimit = createRateLimit(1, 1000);
  const { remote } = createRemote<string>("a");
  remote.pipe(rateLimit).subscribe(logConsumer);
  remote.pipe(rateLimit).subscribe(logConsumer).dispose();
  expect(vi.getTimerCount()).toBe(0);
  vi.advanceTimersByTime(1000);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "produce",
        "a0",
      ],
    ]
  `);
});

test("createRateLimit: dispose while waiting gives the slot back", () => {
  const rateLimit = createRateLimit(2, 1000);
  const { remote } = createRemote<string>("a");
  const limited = remote.pipe(rateLimit);
  limited.subscribe(logConsumer);
  limited.subscribe(logConsumer);
  const waitingSubscription = limited.subscribe(logConsumer);
  limited.subscribe(logConsumer);
  waitingSubscription.dispose();
  // Takes the slot given back, rather than waiting until 2000 ms.
  limited.subscribe(logConsumer);
  vi.advanceTimersByTime(1000);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "produce",
        "a0",
      ],
      [
        "produce",
        "a1",
      ],
      "1000 ms passed",
      [
        "produce",
        "a2",
      ],
      [
        "produce",
        "a3",
      ],
    ]
  `);
  expect(vi.getTimerCount()).toBe(0);
});

test("createRateLimit: passes the dependency through", () => {
  const rateLimit = createRateLimit(1, 1000);
  const source = new LazyPromise<void, string>((sink, dep) => {
    log("dep", dep);
    sink.resolve();
  });
  source.pipe(rateLimit).subscribe(logConsumer, "dep 0");
  source.pipe(rateLimit).subscribe(logConsumer, "dep 1");
  vi.advanceTimersByTime(1000);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "dep",
        "dep 0",
      ],
      [
        "handleValue",
        undefined,
      ],
      "1000 ms passed",
      [
        "dep",
        "dep 1",
      ],
      [
        "handleValue",
        undefined,
      ],
    ]
  `);
});

//
// Token refresh on 401
//

const createApi = () => {
  // Stands in for the cookie.
  let tokenValid = false;
  const fetchRefreshToken = () => {
    log("refresh");
    return Promise.resolve().then(() => {
      tokenValid = true;
    });
  };
  const withAuth = createAuth(fetchRefreshToken);
  const { remote, resolve } = createRemote<string>("a");
  const callApi = (id: number) =>
    defer(() => {
      log("callApi", id, tokenValid);
      return tokenValid ? remote : box(new ErrorBox("unauthorized" as const));
    }).pipe(withAuth);
  return { withAuth, callApi, resolve };
};

test("withAuth: refreshes and retries", async () => {
  const { callApi, resolve } = createApi();
  callApi(1).subscribe<any>(logConsumer);
  await flushMicrotasks();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "callApi",
        1,
        false,
      ],
      [
        "refresh",
      ],
      [
        "callApi",
        1,
        true,
      ],
      [
        "produce",
        "a0",
      ],
    ]
  `);
  resolve("a0", "value");
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "dispose",
        "a0",
      ],
      [
        "handleValue",
        "value",
      ],
    ]
  `);
});

test("withAuth: concurrent failures share a refresh", async () => {
  const { callApi } = createApi();
  callApi(1).subscribe<any>(logConsumer);
  callApi(2).subscribe<any>(logConsumer);
  await flushMicrotasks();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "callApi",
        1,
        false,
      ],
      [
        "refresh",
      ],
      [
        "callApi",
        2,
        false,
      ],
      [
        "callApi",
        1,
        true,
      ],
      [
        "produce",
        "a0",
      ],
      [
        "callApi",
        2,
        true,
      ],
      [
        "produce",
        "a1",
      ],
    ]
  `);
});

test("withAuth: retries without refreshing after a concurrent refresh", async () => {
  const { withAuth, callApi } = createApi();
  const { remote: slow, resolve: resolveSlow } =
    createRemote<ErrorBox<"unauthorized">>("slow");
  // Fails slowly with the expired token.
  slow.pipe(withAuth).subscribe<any>(logConsumer);
  // Meanwhile, another call refreshes the token.
  callApi(1).subscribe<any>(logConsumer);
  await flushMicrotasks();
  readLog();
  resolveSlow("slow0", new ErrorBox("unauthorized"));
  // No refresh.
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "dispose",
        "slow0",
      ],
      [
        "produce",
        "slow1",
      ],
    ]
  `);
});
