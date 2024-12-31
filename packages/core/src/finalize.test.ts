import { afterEach, expect, test } from "@jest/globals";
import { pipe } from "pipe-function";
import { finalize } from "./finalize";
import { rejected, resolved } from "./lazyPromise";

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

test("resolve", () => {
  const promise = pipe(
    resolved(1),
    finalize(() => {
      log("finalize");
    }),
  );
  promise.subscribe((value) => {
    log("resolve", value);
  });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "finalize",
      ],
      [
        "resolve",
        1,
      ],
    ]
  `);
});

test("reject", () => {
  const promise = pipe(
    rejected(1),
    finalize(() => {
      log("finalize");
    }),
  );
  promise.subscribe(undefined, (error) => {
    log("reject", error);
  });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "finalize",
      ],
      [
        "reject",
        1,
      ],
    ]
  `);
});
