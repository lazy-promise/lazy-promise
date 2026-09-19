import type { LazyPromise } from "./lazyPromise.js";
import type { Span, Tracer } from "./trace.js";
import { throwInMicrotask } from "./utils.js";

const instanceCountMap = new Map<string | number | undefined, number>();

const labelMap = new WeakMap<
  LazyPromise<any, any>,
  string | number | undefined
>();

const formatNewLabel = (label: string | number | undefined) =>
  label === undefined ? "no label" : "label " + JSON.stringify(label);

const formatOldLabel = (
  oldLabel: string | number | undefined,
  newLabel: string | number | undefined,
) =>
  oldLabel === newLabel
    ? oldLabel === undefined
      ? "also no label"
      : "same label"
    : oldLabel === undefined
      ? "no label"
      : "label " + JSON.stringify(oldLabel);

/* eslint-disable no-console */

// `run` calls can be physically nested, so each patch has to wrap the
// unpatched `console.log` rather than the current one. Valid while
// `activeRuns` is positive.
let originalLog = console.log;
let activeRuns = 0;

class LogTracer implements Tracer<any, any>, Span<any> {
  constructor(public prefix: string[]) {}

  subscribe(dep: unknown) {
    console.log(...this.prefix, `[subscribe]`, dep);
    return this;
  }

  run(work: () => void, depth: number) {
    if (activeRuns++ === 0) {
      originalLog = console.log;
    }
    const previousLog = console.log;
    const dots = "\u00B7 ".repeat(depth);
    console.log = (...args) => {
      if (typeof args[0] === "string") {
        originalLog(dots + args[0], ...args.slice(1));
        return;
      }
      originalLog(dots.trimEnd(), ...args);
    };
    work();
    console.log = previousLog;
    activeRuns--;
  }

  resolve(value: unknown) {
    console.log(...this.prefix, `[resolve]`, value);
  }

  reject(error: unknown) {
    console.log(...this.prefix, `[reject]`, error);
  }

  flatten() {
    console.log(...this.prefix, `[flatten]`);
  }

  unsubscribe() {
    console.log(...this.prefix, `[unsubscribe]`);
  }
}

/* eslint-enable no-console */

export const log = (
  lazyPromise: LazyPromise<any, any>,
  label: string | number | undefined,
): void => {
  if (labelMap.has(lazyPromise)) {
    throwInMicrotask(
      new Error(
        `The .log(...) call (${formatNewLabel(label)}) was ignored because the LazyPromise is already being logged (${formatOldLabel(labelMap.get(lazyPromise), label)}).`,
      ),
    );
    return;
  }
  labelMap.set(lazyPromise, label);
  const id = (instanceCountMap.get(label) ?? 0) + 1;
  instanceCountMap.set(label, id);
  lazyPromise.trace(
    new LogTracer([...(label === undefined ? [] : [`[${label}]`]), `[${id}]`]),
  );
};
