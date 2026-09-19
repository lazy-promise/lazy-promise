/* eslint-disable no-console */

import type { Consumer, Sink, Span, Tracer } from "@lazy-promise/core";
import {
  all,
  box,
  fromGen,
  inMicrotask,
  LazyPromise,
  race,
  rejecting,
} from "@lazy-promise/core";
import { AsyncLocalStorage } from "node:async_hooks";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

// A logger like `.log(label)` that additionally tracks causality across async
// boundaries. Each entry is linked, through AsyncLocalStorage, to the entry in
// whose `run` it was caused. When an entry is logged outside of any `run`,
// which is what happens right after an async boundary, the chain of entries
// leading to it is printed first as `CONTEXT: ...`, and the dots restart.
//
// `console.log` is patched only while a `run` is on the stack, so the dots do
// not survive an async boundary crossed by user code (the CONTEXT line does).
// That is why `.log` does not do this: the output gets hard to read.

class Entry {
  constructor(
    public text: string,
    public parent: Entry | undefined,
  ) {}

  toString(): string {
    return this.parent ? `${this.parent} -> ${this.text}` : this.text;
  }
}

const als = new AsyncLocalStorage<Entry>();
const instanceCountMap = new Map<string, number>();
let originalLog = console.log;
let activeRuns = 0;

const formatDots = (depth: number) =>
  depth > 10 ? `\u00B7 * ${depth} ` : "\u00B7 ".repeat(depth);

class AsyncLogSpan implements Span<any> {
  // The last notification; `run` wraps its consequences.
  cause: Entry;

  constructor(
    public prefix: string,
    dep: unknown,
  ) {
    this.cause = this.log("subscribe", dep);
  }

  log(event: string, ...args: unknown[]) {
    const parent = als.getStore();
    if (activeRuns === 0 && parent) {
      console.log("CONTEXT:", String(parent));
    }
    const text = `${this.prefix} [${event}]`;
    console.log(text, ...args);
    return new Entry(text, parent);
  }

  run(work: () => void, depth: number) {
    if (activeRuns++ === 0) {
      originalLog = console.log;
    }
    const previousLog = console.log;
    const dots = formatDots(depth);
    console.log = (...args) => {
      if (typeof args[0] === "string") {
        originalLog(dots + args[0], ...args.slice(1));
        return;
      }
      originalLog(dots.trimEnd(), ...args);
    };
    als.run(this.cause, work);
    console.log = previousLog;
    activeRuns--;
  }

  resolve(value: unknown) {
    this.cause = this.log("resolve", value);
  }

  reject(error: unknown) {
    this.cause = this.log("reject", error);
  }

  flatten() {
    this.cause = this.log("flatten");
  }

  unsubscribe() {
    this.cause = this.log("unsubscribe");
  }
}

class AsyncLogTracer implements Tracer<any, any> {
  constructor(public label: string) {}

  subscribe(dep: unknown) {
    const id = (instanceCountMap.get(this.label) ?? 0) + 1;
    instanceCountMap.set(this.label, id);
    return new AsyncLogSpan(`[${this.label}] [${id}]`, dep);
  }
}

const asyncLog =
  (label: string) =>
  <T extends LazyPromise<any, any>>(lazyPromise: T): T => {
    lazyPromise.trace(new AsyncLogTracer(label));
    return lazyPromise;
  };

const logContents: string[] = [];

const readLog = () => {
  try {
    return [...logContents];
  } finally {
    logContents.length = 0;
  }
};

const logConsumer: Consumer<any> = {
  resolve: (value) => {
    console.log("handleValue", value);
  },
  reject: (error) => {
    console.log("handleError", error);
  },
};

const flushMicrotasks = () => new Promise<void>(queueMicrotask);

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation((...args) => {
    logContents.push(args.map(String).join(" "));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  instanceCountMap.clear();
  try {
    if (logContents.length) {
      throw new Error("Log expected to be empty at the end of each test.");
    }
    if (activeRuns !== 0) {
      throw new Error("No run expected to be active at the end of each test.");
    }
  } finally {
    logContents.length = 0;
    activeRuns = 0;
  }
});

test("synchronous causality is shown with dots, like with `log`", () => {
  new LazyPromise<number, "dep">((sink, dep) => {
    console.log("producing", dep);
    sink.resolve(1);
    return () => {
      console.log("tearing down");
    };
  })
    .pipe(asyncLog("a"))
    .subscribe(logConsumer, "dep");
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "[a] [1] [subscribe] dep",
      "· producing dep",
      "· [a] [1] [resolve] 1",
      "· · tearing down",
      "· · handleValue 1",
    ]
  `);
});

test("an entry logged after an async boundary is preceded by its context", async () => {
  new LazyPromise<number>((sink) => {
    console.log("producing");
    queueMicrotask(() => {
      sink.resolve(1);
    });
    return () => {
      console.log("tearing down");
    };
  })
    .pipe(asyncLog("a"))
    .subscribe(logConsumer);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "[a] [1] [subscribe] undefined",
      "· producing",
    ]
  `);
  await flushMicrotasks();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "CONTEXT: [a] [1] [subscribe]",
      "[a] [1] [resolve] 1",
      "· tearing down",
      "· handleValue 1",
    ]
  `);
});

test("rejection after an async boundary", async () => {
  new LazyPromise<never>((sink) => {
    queueMicrotask(() => {
      sink.reject("oops");
    });
  })
    .pipe(asyncLog("a"))
    .subscribe(logConsumer);
  await flushMicrotasks();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "[a] [1] [subscribe] undefined",
      "CONTEXT: [a] [1] [subscribe]",
      "[a] [1] [reject] oops",
      "· handleError oops",
    ]
  `);
});

test("unsubscribe", () => {
  const promise = new LazyPromise<never>(() => () => {
    console.log("tearing down");
  }).pipe(asyncLog("a"));

  promise.subscribe().dispose();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "[a] [1] [subscribe] undefined",
      "[a] [1] [unsubscribe]",
      "· tearing down",
    ]
  `);

  // Disposed by the consumer of another traced promise.
  const subscription = promise.subscribe();
  box(1)
    .pipe(asyncLog("b"))
    .subscribe({
      resolve: () => {
        subscription.dispose();
      },
    });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "[a] [2] [subscribe] undefined",
      "[b] [1] [subscribe] undefined",
      "· [b] [1] [resolve] 1",
      "· · [a] [2] [unsubscribe]",
      "· · · tearing down",
    ]
  `);
});

test("downstream promises are linked to the upstream resolve across async boundaries", async () => {
  inMicrotask()
    .pipe(asyncLog("a"))
    .map(() => inMicrotask().pipe(asyncLog("b")))
    .map(() => box(3).pipe(asyncLog("c")))
    .subscribe(logConsumer);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "[a] [1] [subscribe] undefined",
    ]
  `);
  await flushMicrotasks();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "CONTEXT: [a] [1] [subscribe]",
      "[a] [1] [resolve] undefined",
      "· [b] [1] [subscribe] undefined",
      "CONTEXT: [a] [1] [subscribe] -> [a] [1] [resolve] -> [b] [1] [subscribe]",
      "[b] [1] [resolve] undefined",
      "· [c] [1] [subscribe] undefined",
      "· · [c] [1] [resolve] 3",
      "· · · handleValue 3",
    ]
  `);
  await flushMicrotasks();
  expect(readLog()).toMatchInlineSnapshot(`[]`);
});

test("user code crossing an async boundary keeps the context but loses the dots", async () => {
  const promise = new LazyPromise<never>(() => {}).pipe(asyncLog("a"));
  const subscription = promise.subscribe();
  box(1)
    .pipe(asyncLog("b"))
    .subscribe({
      resolve: () => {
        queueMicrotask(() => {
          console.log("in the microtask");
          box(2).pipe(asyncLog("c")).subscribe(logConsumer);
          subscription.dispose();
        });
      },
    });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "[a] [1] [subscribe] undefined",
      "[b] [1] [subscribe] undefined",
      "· [b] [1] [resolve] 1",
    ]
  `);
  await flushMicrotasks();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "in the microtask",
      "CONTEXT: [b] [1] [subscribe] -> [b] [1] [resolve]",
      "[c] [1] [subscribe] undefined",
      "· [c] [1] [resolve] 2",
      "· · handleValue 2",
      "CONTEXT: [b] [1] [subscribe] -> [b] [1] [resolve]",
      "[a] [1] [unsubscribe]",
    ]
  `);
});

test("nesting is preserved through untraced intermediate promises", () => {
  box(1)
    .pipe(asyncLog("a"))
    .map((value) => value + 1)
    .subscribe(logConsumer);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "[a] [1] [subscribe] undefined",
      "· [a] [1] [resolve] 1",
      "· · handleValue 2",
    ]
  `);

  box(1)
    .pipe(asyncLog("b"))
    .map(() => {
      throw "oops";
    })
    .subscribe(logConsumer);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "[b] [1] [subscribe] undefined",
      "· [b] [1] [resolve] 1",
      "· · handleError oops",
    ]
  `);

  const inner = box(2).pipe(asyncLog("inner"));
  box(1)
    .pipe(asyncLog("outer"))
    .map(() => box(undefined).map(() => inner))
    .subscribe(logConsumer);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "[outer] [1] [subscribe] undefined",
      "· [outer] [1] [resolve] 1",
      "· · [inner] [1] [subscribe] undefined",
      "· · · [inner] [1] [resolve] 2",
      "· · · · handleValue 2",
    ]
  `);
});

test("resolving with a LazyPromise", async () => {
  const inner = new LazyPromise<number>((sink) => {
    console.log("producing inner");
    sink.resolve(1);
  }).pipe(asyncLog("inner"));

  new LazyPromise<number>((sink) => {
    sink.resolve(inner);
    return () => {
      console.log("tearing down outer");
    };
  })
    .pipe(asyncLog("outer sync"))
    .subscribe(logConsumer);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "[outer sync] [1] [subscribe] undefined",
      "· [outer sync] [1] [flatten]",
      "· · tearing down outer",
      "· · [inner] [1] [subscribe] undefined",
      "· · · producing inner",
      "· · · [inner] [1] [resolve] 1",
      "· · · · [outer sync] [1] [resolve] 1",
      "· · · · · handleValue 1",
    ]
  `);

  let sinkAsync: Sink<number>;
  new LazyPromise<number>((sink) => {
    sinkAsync = sink;
    return () => {
      console.log("tearing down outer");
    };
  })
    .pipe(asyncLog("outer async"))
    .subscribe(logConsumer);
  readLog();
  await flushMicrotasks();
  sinkAsync!.resolve(inner);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "[outer async] [1] [flatten]",
      "· tearing down outer",
      "· [inner] [2] [subscribe] undefined",
      "· · producing inner",
      "· · [inner] [2] [resolve] 1",
      "· · · [outer async] [1] [resolve] 1",
      "· · · · handleValue 1",
    ]
  `);
});

test("flatten is only reported to the spans of the resolving promise", () => {
  const inner = box(1).pipe(asyncLog("inner"));
  const mid = new LazyPromise<number>((sink) => {
    sink.resolve(inner);
  }).pipe(asyncLog("mid"));
  new LazyPromise<number>((sink) => {
    sink.resolve(mid);
  })
    .pipe(asyncLog("outer"))
    .subscribe(logConsumer);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "[outer] [1] [subscribe] undefined",
      "· [outer] [1] [flatten]",
      "· · [mid] [1] [subscribe] undefined",
      "· · · [mid] [1] [flatten]",
      "· · · · [inner] [1] [subscribe] undefined",
      "· · · · · [inner] [1] [resolve] 1",
      "· · · · · · [mid] [1] [resolve] 1",
      "· · · · · · · [outer] [1] [resolve] 1",
      "· · · · · · · · handleValue 1",
    ]
  `);
});

test("resolving with a LazyPromise traces like subscribing to it manually", () => {
  const getInner = () =>
    new LazyPromise<number>((sink) => {
      console.log("producing inner");
      sink.resolve(1);
      return () => {
        console.log("tearing down inner");
      };
    }).pipe(asyncLog("inner"));

  new LazyPromise<number>((sink) => getInner().subscribe(sink))
    .pipe(asyncLog("outer"))
    .subscribe(logConsumer);
  const manualLog = readLog();
  expect(manualLog).toMatchInlineSnapshot(`
    [
      "[outer] [1] [subscribe] undefined",
      "· [inner] [1] [subscribe] undefined",
      "· · producing inner",
      "· · [inner] [1] [resolve] 1",
      "· · · tearing down inner",
      "· · · [outer] [1] [resolve] 1",
      "· · · · handleValue 1",
    ]
  `);

  new LazyPromise<number>((sink) => {
    sink.resolve(getInner());
  })
    .pipe(asyncLog("outer"))
    .subscribe(logConsumer);
  const flattenedLog = readLog();
  expect(flattenedLog).toMatchInlineSnapshot(`
    [
      "[outer] [2] [subscribe] undefined",
      "· [outer] [2] [flatten]",
      "· · [inner] [2] [subscribe] undefined",
      "· · · producing inner",
      "· · · [inner] [2] [resolve] 1",
      "· · · · tearing down inner",
      "· · · · [outer] [2] [resolve] 1",
      "· · · · · handleValue 1",
    ]
  `);
  // Same as the manual log, except for the flatten entry and the extra dot it
  // adds to what follows, and the instance numbers.
  expect(flattenedLog.slice(2).map((line) => line.slice(2))).toEqual(
    manualLog.slice(1).map((line) => line.replace("[1]", "[2]")),
  );
});

test("unsubscribing after resolving with a LazyPromise traces like unsubscribing manually", () => {
  const getInner = () =>
    new LazyPromise<never>(() => () => {
      console.log("tearing down inner");
    }).pipe(asyncLog("inner"));

  new LazyPromise<never>((sink) => getInner().subscribe(sink))
    .pipe(asyncLog("outer"))
    .subscribe()
    .dispose();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "[outer] [1] [subscribe] undefined",
      "· [inner] [1] [subscribe] undefined",
      "[outer] [1] [unsubscribe]",
      "· [inner] [1] [unsubscribe]",
      "· · tearing down inner",
    ]
  `);

  new LazyPromise<never>((sink) => {
    sink.resolve(getInner());
  })
    .pipe(asyncLog("outer"))
    .subscribe()
    .dispose();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "[outer] [2] [subscribe] undefined",
      "· [outer] [2] [flatten]",
      "· · [inner] [2] [subscribe] undefined",
      "[outer] [2] [unsubscribe]",
      "· [inner] [2] [unsubscribe]",
      "· · tearing down inner",
    ]
  `);
});

test("more than 10 dots are abbreviated", () => {
  const nest = (remaining: number): LazyPromise<string> =>
    box(remaining)
      .pipe(asyncLog("nest"))
      .map(() => (remaining === 0 ? "value" : nest(remaining - 1)));
  nest(5).subscribe(logConsumer);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "[nest] [1] [subscribe] undefined",
      "· [nest] [1] [resolve] 5",
      "· · [nest] [2] [subscribe] undefined",
      "· · · [nest] [2] [resolve] 4",
      "· · · · [nest] [3] [subscribe] undefined",
      "· · · · · [nest] [3] [resolve] 3",
      "· · · · · · [nest] [4] [subscribe] undefined",
      "· · · · · · · [nest] [4] [resolve] 2",
      "· · · · · · · · [nest] [5] [subscribe] undefined",
      "· · · · · · · · · [nest] [5] [resolve] 1",
      "· · · · · · · · · · [nest] [6] [subscribe] undefined",
      "· * 11 [nest] [6] [resolve] 0",
      "· * 12 handleValue value",
    ]
  `);
});

test("siblings: dots go back down, and each keeps its own context", async () => {
  box(1)
    .pipe(asyncLog("a"))
    .subscribe({
      resolve: () => {
        box(2).pipe(asyncLog("b")).subscribe(logConsumer);
        new LazyPromise<number>((sink) => {
          queueMicrotask(() => {
            sink.resolve(4);
          });
        })
          .pipe(asyncLog("c"))
          .subscribe(logConsumer);
        box(3).pipe(asyncLog("b")).subscribe(logConsumer);
      },
    });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "[a] [1] [subscribe] undefined",
      "· [a] [1] [resolve] 1",
      "· · [b] [1] [subscribe] undefined",
      "· · · [b] [1] [resolve] 2",
      "· · · · handleValue 2",
      "· · [c] [1] [subscribe] undefined",
      "· · [b] [2] [subscribe] undefined",
      "· · · [b] [2] [resolve] 3",
      "· · · · handleValue 3",
    ]
  `);
  await flushMicrotasks();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "CONTEXT: [a] [1] [subscribe] -> [a] [1] [resolve] -> [c] [1] [subscribe]",
      "[c] [1] [resolve] 4",
      "· handleValue 4",
    ]
  `);
});

test("an inner promise settling asynchronously after a flatten", async () => {
  const getInner = () =>
    new LazyPromise<number>((sink) => {
      queueMicrotask(() => {
        sink.resolve(1);
      });
    }).pipe(asyncLog("inner"));

  new LazyPromise<number>((sink) => {
    sink.resolve(getInner());
  })
    .pipe(asyncLog("outer"))
    .subscribe(logConsumer);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "[outer] [1] [subscribe] undefined",
      "· [outer] [1] [flatten]",
      "· · [inner] [1] [subscribe] undefined",
    ]
  `);
  await flushMicrotasks();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "CONTEXT: [outer] [1] [subscribe] -> [outer] [1] [flatten] -> [inner] [1] [subscribe]",
      "[inner] [1] [resolve] 1",
      "· [outer] [1] [resolve] 1",
      "· · handleValue 1",
    ]
  `);

  // The same with a manual subscription instead of a flatten.
  new LazyPromise<number>((sink) => getInner().subscribe(sink))
    .pipe(asyncLog("outer"))
    .subscribe(logConsumer);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "[outer] [2] [subscribe] undefined",
      "· [inner] [2] [subscribe] undefined",
    ]
  `);
  await flushMicrotasks();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "CONTEXT: [outer] [2] [subscribe] -> [inner] [2] [subscribe]",
      "[inner] [2] [resolve] 1",
      "· [outer] [2] [resolve] 1",
      "· · handleValue 1",
    ]
  `);
});

test("catch", async () => {
  new LazyPromise<never>((sink) => {
    queueMicrotask(() => {
      sink.reject("oops");
    });
  })
    .pipe(asyncLog("a"))
    .catch(() => box(1).pipe(asyncLog("b")))
    .subscribe(logConsumer);
  await flushMicrotasks();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "[a] [1] [subscribe] undefined",
      "CONTEXT: [a] [1] [subscribe]",
      "[a] [1] [reject] oops",
      "· [b] [1] [subscribe] undefined",
      "· · [b] [1] [resolve] 1",
      "· · · handleValue 1",
    ]
  `);
});

test("all: downstream is linked to the input that settled last", async () => {
  // Settles a microtask later than `b`.
  const a = new LazyPromise<number>((sink) => {
    queueMicrotask(() => {
      queueMicrotask(() => {
        sink.resolve(0);
      });
    });
  }).pipe(asyncLog("a"));
  const b = inMicrotask().pipe(asyncLog("b"));
  all([a, b])
    .map(() => box(1).pipe(asyncLog("c")))
    .subscribe(logConsumer);
  await flushMicrotasks();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "[a] [1] [subscribe] undefined",
      "[b] [1] [subscribe] undefined",
      "CONTEXT: [b] [1] [subscribe]",
      "[b] [1] [resolve] undefined",
      "CONTEXT: [a] [1] [subscribe]",
      "[a] [1] [resolve] 0",
      "· [c] [1] [subscribe] undefined",
      "· · [c] [1] [resolve] 1",
      "· · · handleValue 1",
    ]
  `);
  await flushMicrotasks();
  expect(readLog()).toMatchInlineSnapshot(`[]`);
});

test("race: the loser is unsubscribed in the context of the winner's resolve", async () => {
  const a = new LazyPromise<never>(() => {}).pipe(asyncLog("a"));
  const b = inMicrotask().pipe(asyncLog("b"));
  race([a, b]).subscribe(logConsumer);
  await flushMicrotasks();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "[a] [1] [subscribe] undefined",
      "[b] [1] [subscribe] undefined",
      "CONTEXT: [b] [1] [subscribe]",
      "[b] [1] [resolve] undefined",
      "· [a] [1] [unsubscribe]",
      "· handleValue undefined",
    ]
  `);
});

test("fromGen", async () => {
  const a = inMicrotask().pipe(asyncLog("a"));
  const b = rejecting("oops").pipe(asyncLog("b"));
  fromGen(function* () {
    yield* a;
    try {
      yield* b;
    } catch {
      console.log("caught");
    }
    return 1;
  }).subscribe(logConsumer);
  await flushMicrotasks();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "[a] [1] [subscribe] undefined",
      "CONTEXT: [a] [1] [subscribe]",
      "[a] [1] [resolve] undefined",
      "· [b] [1] [subscribe] undefined",
      "· · [b] [1] [reject] oops",
      "· caught",
      "· handleValue 1",
    ]
  `);
});

/* eslint-enable no-console */
