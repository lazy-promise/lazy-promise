import type { Consumer } from "@lazy-promise/core";
import { box, inMessageChannel } from "@lazy-promise/core";
import { afterEach, expect, test, vi } from "vitest";

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

const logConsumer: Consumer<any> = {
  resolve: (value) => {
    log("handleValue", value);
  },
  reject: (error) => {
    log("handleError", error);
  },
};

const flushMessageQueue = () =>
  new Promise<void>((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      channel.port2.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });

afterEach(() => {
  vi.restoreAllMocks();
  try {
    if (logContents.length) {
      throw new Error("Log expected to be empty at the end of each test.");
    }
  } finally {
    logContents.length = 0;
  }
});

test("resolve", async () => {
  inMessageChannel().subscribe(logConsumer);
  expect(readLog()).toMatchInlineSnapshot(`[]`);
  await flushMessageQueue();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleValue",
        undefined,
      ],
    ]
  `);
});

test("resolve multiple", async () => {
  box(1)
    .finally(inMessageChannel)
    .subscribe({
      resolve: (value) => {
        log("resolve first", value);
      },
    });
  box(2)
    .finally(inMessageChannel)
    .subscribe({
      resolve: (value) => {
        log("resolve second", value);
      },
    });
  expect(readLog()).toMatchInlineSnapshot(`[]`);
  await flushMessageQueue();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "resolve first",
        1,
      ],
      [
        "resolve second",
        2,
      ],
    ]
  `);
});

test("cancel", async () => {
  inMessageChannel().subscribe(logConsumer).dispose();
  await flushMessageQueue();
  expect(readLog()).toMatchInlineSnapshot(`[]`);
});

test("the port is unrefed once the queue is empty", async () => {
  // Node-only methods, absent from the DOM types.
  const portPrototype = MessagePort.prototype as unknown as {
    ref(): void;
    unref(): void;
  };
  const ref = vi.spyOn(portPrototype, "ref");
  const unref = vi.spyOn(portPrototype, "unref");
  inMessageChannel().subscribe(logConsumer);
  inMessageChannel().subscribe(logConsumer);
  expect(ref).toHaveBeenCalledTimes(2);
  const port = ref.mock.contexts[0];
  const countUnrefs = () =>
    unref.mock.contexts.filter((context) => context === port).length;
  expect(countUnrefs()).toBe(0);
  await flushMessageQueue();
  expect(countUnrefs()).toBe(1);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleValue",
        undefined,
      ],
      [
        "handleValue",
        undefined,
      ],
    ]
  `);
});
