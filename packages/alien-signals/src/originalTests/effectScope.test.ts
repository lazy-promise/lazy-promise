import { expect, test } from "vitest";
import { effect, effectScope, flush, signal } from "..";

test("scope dispose runs child effect cleanup", () => {
  const log: string[] = [];
  const dispose = effectScope(() => {
    effect(() => () => log.push("inner:cleanup"));
  });
  dispose();
  expect(log).toEqual(["inner:cleanup"]);
});

test("scope dispose: sibling effects clean up in reverse creation (LIFO)", () => {
  const log: string[] = [];
  const dispose = effectScope(() => {
    effect(() => () => log.push("e1:cleanup"));
    effect(() => () => log.push("e2:cleanup"));
    effect(() => () => log.push("e3:cleanup"));
  });
  dispose();
  expect(log).toEqual(["e3:cleanup", "e2:cleanup", "e1:cleanup"]);
});

test("scope dispose: nested effect cleanup runs depth-first reverse", () => {
  const log: string[] = [];
  const dispose = effectScope(() => {
    effect(() => {
      effect(() => () => log.push("grandchild:cleanup"));
      return () => log.push("child:cleanup");
    });
  });
  dispose();
  expect(log).toEqual(["grandchild:cleanup", "child:cleanup"]);
});

test("scope as intermediate parent: cleanup order respects nesting", () => {
  // When effectScope is used as an intermediate scope inside an outer
  // effect, the outer's re-run must still dispose the scope (and its
  // effects) before running the outer's own cleanup.
  const a = signal(0);
  const log: string[] = [];

  effect(() => {
    a();
    log.push("outer:run");
    effectScope(() => {
      effect(() => {
        log.push("inner:run");
        return () => log.push("inner:cleanup");
      });
    });
    return () => log.push("outer:cleanup");
  });
  log.length = 0;

  a(1);
  flush();
  expect(log).toEqual([
    "inner:cleanup",
    "outer:cleanup",
    "outer:run",
    "inner:run",
  ]);
});
