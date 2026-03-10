import type { InnerSubscriber } from "@lazy-promise/core";
import { box, LazyPromise, rejecting, toEager } from "@lazy-promise/core";
import { afterEach, expect, test } from "vitest";

const logContents: unknown[] = [];

const log = (...args: unknown[]) => {
  logContents.push(args);
};

const readLog = () => {
  try {
    return [...logContents];
  } finally {
    logContents.length = 0;
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

const flushMicrotasks = async () => {
  await new Promise((resolve) => {
    setTimeout(resolve);
  });
};

test("no signal, resolve", async () => {
  expect(await toEager(box("value"))).toMatchInlineSnapshot(`"value"`);
});

test("no signal, reject", async () => {
  await expect(() => toEager(rejecting("oops"))).rejects.toMatchInlineSnapshot(
    `"oops"`,
  );
});

test("signal, sync resolve", async () => {
  expect(
    await toEager(box("value"), { signal: new AbortController().signal }),
  ).toMatchInlineSnapshot(`"value"`);
});

test("signal, async resolve", async () => {
  let subscriber: InnerSubscriber<"value">;
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  toEager(
    new LazyPromise<"value">((subscriberLocal) => {
      subscriber = subscriberLocal;
    }),
    { signal: new AbortController().signal },
  ).then((value) => {
    log("resolve", value);
  });
  subscriber!.resolve("value");
  expect(readLog()).toMatchInlineSnapshot(`[]`);
  await flushMicrotasks();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "resolve",
        "value",
      ],
    ]
  `);
});

test("signal, sync reject", async () => {
  await expect(() =>
    toEager(rejecting("oops"), { signal: new AbortController().signal }),
  ).rejects.toMatchInlineSnapshot(`"oops"`);
});

test("signal, async reject", async () => {
  let subscriber: InnerSubscriber<never>;
  toEager(
    new LazyPromise<never>((subscriberLocal) => {
      subscriber = subscriberLocal;
    }),
    { signal: new AbortController().signal },
  ).catch((error) => {
    log("rejected", error);
  });
  subscriber!.reject("oops");
  expect(readLog()).toMatchInlineSnapshot(`[]`);
  await flushMicrotasks();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "rejected",
        "oops",
      ],
    ]
  `);
});

test("already aborted signal", async () => {
  const abortController = new AbortController();
  abortController.abort("reason");
  await expect(() =>
    toEager(
      new LazyPromise<never>(() => {
        log("subscribe");
      }),
      { signal: abortController.signal },
    ),
  ).rejects.toMatchInlineSnapshot(`"reason"`);
  expect(readLog()).toMatchInlineSnapshot(`[]`);
});

test("signal aborted while subscribing", async () => {
  const abortController = new AbortController();
  const promise = toEager(
    new LazyPromise<never>(() => {
      log("subscribe");
      abortController.abort("reason");
      return () => {
        log("unsubscribe");
      };
    }),
    { signal: abortController.signal },
  );
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "subscribe",
      ],
      [
        "unsubscribe",
      ],
    ]
  `);
  await expect(() => promise).rejects.toMatchInlineSnapshot(`"reason"`);
});

test("signal aborted after subscribing", async () => {
  const abortController = new AbortController();
  toEager(
    new LazyPromise<never>(() => {
      log("subscribe");
      return () => {
        log("unsubscribe");
      };
    }),
    { signal: abortController.signal },
  ).catch((error) => {
    log("rejected", error);
  });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "subscribe",
      ],
    ]
  `);
  abortController.abort("reason");
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "unsubscribe",
      ],
    ]
  `);
  await flushMicrotasks();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "rejected",
        "reason",
      ],
    ]
  `);
});
