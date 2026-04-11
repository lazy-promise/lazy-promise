import type { Subscriber } from "@lazy-promise/core";
import { box, inMessageChannel } from "@lazy-promise/core";
import { afterEach, beforeEach, expect, test } from "vitest";

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

const logSubscriber: Subscriber<any> = {
  resolve: (value) => {
    log("handleValue", value);
  },
  reject: (error) => {
    log("handleError", error);
  },
};

beforeEach(() => {});

afterEach(() => {
  try {
    if (logContents.length) {
      throw new Error("Log expected to be empty at the end of each test.");
    }
  } finally {
    logContents.length = 0;
  }
});

test("resolve", async () => {
  inMessageChannel().subscribe(logSubscriber);
  expect(readLog()).toMatchInlineSnapshot(`[]`);
  await new Promise((resolve) => {
    setTimeout(resolve);
  });
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
    .finalize(inMessageChannel)
    .subscribe({
      resolve: (value) => {
        log("resolve first", value);
      },
    });
  box(2)
    .finalize(inMessageChannel)
    .subscribe({
      resolve: (value) => {
        log("resolve second", value);
      },
    });
  expect(readLog()).toMatchInlineSnapshot(`[]`);
  await new Promise((resolve) => {
    setTimeout(resolve);
  });
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
  inMessageChannel().subscribe(logSubscriber).unsubscribe();
  await new Promise((resolve) => {
    setTimeout(resolve);
  });
  expect(readLog()).toMatchInlineSnapshot(`[]`);
});
