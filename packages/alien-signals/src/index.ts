import type { ErrorBox, Job, Sink, Subscription } from "@lazy-promise/core";
import { LazyPromise } from "@lazy-promise/core";
import type { ReactiveNode } from "alien-signals/system";
import { createReactiveSystem, ReactiveFlags } from "alien-signals/system";

const resolvedSymbol = Symbol("resolved");
const rejectedSymbol = Symbol("rejected");

interface EffectScopeNode extends ReactiveNode {}

interface EffectNode extends ReactiveNode {
  fn(): (() => void) | LazyPromise<any> | void;
  cleanup: (() => void) | void;
}

interface LPState {
  original: LazyPromise<any>;
  // eslint-disable-next-line no-use-before-define
  pendingHead: PendingNode | undefined;
  originalSub: Subscription | undefined;
  status: typeof resolvedSymbol | typeof rejectedSymbol | undefined;
  result: any;
}

interface ComputedNode<T = any> extends ReactiveNode {
  value: T | undefined;
  getter: (previousValue?: T) => T;
  lp?: LPState;
}

interface SignalNode<T = any> extends ReactiveNode {
  currentValue: T;
  pendingValue: T;
  queued?: boolean;
}

// Marks a parent (effect or scope) whose deps include at least one child
// effect. Used to gate the dispose-children-first slow path in run() so
// leaf effects (no children, no own cleanup) avoid the extra deps walk.
// The bit is outside ReactiveFlags' range and never touched by system.ts.
const HasChildEffect = 64;

let cycle = 0;
let runDepth = 0;
let notifyIndex = 0;
let queuedLength = 0;
let signalNotifyIndex = 0;
let signalQueuedLength = 0;
let pendingTriggers = 0;
let autoFlushScheduled = false;
let activeSub: ReactiveNode | undefined;

const queued: (EffectNode | undefined)[] = [];
const signalQueued: (SignalNode | undefined)[] = [];
const { link, unlink, propagate, checkDirty, shallowPropagate } =
  createReactiveSystem({
    update(node: SignalNode | ComputedNode | EffectScopeNode): boolean {
      if ("getter" in node) {
        // eslint-disable-next-line no-use-before-define
        return updateComputed(node);
      }
      if ("currentValue" in node) {
        // eslint-disable-next-line no-use-before-define
        return updateSignal(node);
      }
      node.flags = ReactiveFlags.Mutable;
      return true;
    },
    notify(effect: EffectNode) {
      let insertIndex = queuedLength;
      let firstInsertedIndex = insertIndex;

      do {
        queued[insertIndex++] = effect;
        effect.flags &= ~ReactiveFlags.Watching;
        effect = effect.subs?.sub as EffectNode;
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (effect === undefined || !(effect.flags & ReactiveFlags.Watching)) {
          break;
        }
      } while (true);

      queuedLength = insertIndex;

      while (firstInsertedIndex < --insertIndex) {
        const left = queued[firstInsertedIndex];
        queued[firstInsertedIndex++] = queued[insertIndex];
        queued[insertIndex] = left;
      }
    },
    unwatched(node: SignalNode | ComputedNode | EffectNode | EffectScopeNode) {
      if ("getter" in node) {
        if (node.depsTail !== undefined) {
          node.flags = ReactiveFlags.Mutable | ReactiveFlags.Dirty;
          // eslint-disable-next-line no-use-before-define
          disposeAllDepsInReverse(node);
        }
        if (node.lp !== undefined) {
          const lp = node.lp;
          lp.status = undefined;
          lp.result = undefined;
          if (lp.pendingHead === undefined) {
            lp.originalSub?.dispose();
            lp.originalSub = undefined;
          }
        }
      } else if ("currentValue" in node) {
        // Nothing to do for signals, they are always mutable and never dirty until pendingValue changes
      } else if ("fn" in node) {
        // eslint-disable-next-line no-use-before-define
        effectOper.call(node);
      } else {
        // eslint-disable-next-line no-use-before-define
        effectScopeOper.call(node);
      }
    },
  });

export const getActiveSub = (): ReactiveNode | undefined => activeSub;

export const setActiveSub = (sub?: ReactiveNode) => {
  const prevSub = activeSub;
  activeSub = sub;
  return prevSub;
};

const disposeAllDepsInReverse = (sub: ReactiveNode): void => {
  let link = sub.depsTail;
  while (link !== undefined) {
    const prev = link.prevDep;
    unlink(link, sub);
    link = prev;
  }
};

const purgeDeps = (sub: ReactiveNode) => {
  const depsTail = sub.depsTail;
  let dep = depsTail !== undefined ? depsTail.nextDep : sub.deps;
  while (dep !== undefined) {
    dep = unlink(dep, sub);
  }
};

class PendingNode {
  // eslint-disable-next-line no-use-before-define
  next: PendingNode | undefined = undefined;

  constructor(
    public sink: Sink<any>,
    public state: LPState,
    public c: ComputedNode,
  ) {}

  dispose() {
    const { state, c } = this;
    if (state.pendingHead === this) {
      state.pendingHead = this.next;
    } else {
      let prev = state.pendingHead;
      while (prev !== undefined && prev.next !== this) {
        prev = prev.next;
      }
      if (prev !== undefined) {
        prev.next = this.next;
      }
    }
    if (state.pendingHead === undefined && c.subs === undefined) {
      state.originalSub?.dispose();
      state.originalSub = undefined;
      state.status = undefined;
      state.result = undefined;
    }
  }
}

class OriginalConsumer {
  // Set to true when the original settles synchronously during subscribe().
  // Checked in subscribeToOriginal to skip storing an already-done subscription.
  settled = false;

  constructor(
    public state: LPState,
    public c: ComputedNode,
  ) {}

  resolve(v: any) {
    this.settled = true;
    const { state, c } = this;
    state.originalSub = undefined;
    if (c.subs !== undefined) {
      state.status = resolvedSymbol;
      state.result = v;
    }
    let node = state.pendingHead;
    state.pendingHead = undefined;
    while (node !== undefined) {
      node.sink.resolve(v);
      node = node.next;
    }
  }

  reject(error: unknown) {
    this.settled = true;
    const { state, c } = this;
    state.originalSub = undefined;
    if (c.subs !== undefined) {
      state.status = rejectedSymbol;
      state.result = error;
    }
    let node = state.pendingHead;
    state.pendingHead = undefined;
    while (node !== undefined) {
      node.sink.reject(error);
      node = node.next;
    }
  }
}

class ProxyProducer {
  constructor(
    private state: LPState,
    private c: ComputedNode,
  ) {}

  produce(sink: Sink<any>): Job | void {
    const { state, c } = this;
    if (state.status === resolvedSymbol) {
      sink.resolve(state.result);
      return;
    }
    if (state.status === rejectedSymbol) {
      sink.reject(state.result);
      return;
    }
    const node = new PendingNode(sink, state, c);
    node.next = state.pendingHead;
    state.pendingHead = node;
    if (state.originalSub === undefined) {
      // eslint-disable-next-line no-use-before-define
      subscribeToOriginal(state, c, state.original);
    }
    return node;
  }
}

const subscribeToOriginal = (
  state: LPState,
  c: ComputedNode,
  original: LazyPromise<any>,
): void => {
  // Clear activeSub so reads inside the original's producer don't create
  // reactive dependencies on the computed.
  const prevActiveSub = activeSub;
  activeSub = undefined;
  const consumer = new OriginalConsumer(state, c);
  const sub = original.subscribe<any>(consumer);
  activeSub = prevActiveSub;
  if (!consumer.settled) {
    state.originalSub = sub;
  }
};

const updateLPComputed = (
  c: ComputedNode,
  newOriginal: LazyPromise<any>,
): boolean => {
  const state = c.lp!;
  if (state.originalSub !== undefined) {
    // Old original still pending — unsubscribe it, subscribe new, keep same proxy
    state.originalSub.dispose();
    state.originalSub = undefined;
    state.original = newOriginal;
    subscribeToOriginal(state, c, newOriginal);
    return false;
  }
  // Old original had settled
  const newState: LPState = {
    original: newOriginal,
    pendingHead: undefined,
    originalSub: undefined,
    status: undefined,
    result: undefined,
  };
  subscribeToOriginal(newState, c, newOriginal);
  if (
    newState.status !== undefined &&
    newState.status === state.status &&
    newState.result === state.result
  ) {
    // Synchronously settled to same result — reuse proxy
    state.original = newOriginal;
    return false;
  }
  // New proxy needed
  c.lp = newState;
  c.value = new LazyPromise(new ProxyProducer(newState, c));
  return true;
};

const updateSignal = (s: SignalNode): boolean => {
  s.flags = ReactiveFlags.Mutable;
  return s.currentValue !== (s.currentValue = s.pendingValue);
};

const runCleanup = (e: EffectNode): void => {
  const cleanup = e.cleanup!;
  e.cleanup = undefined;
  const prevSub = activeSub;
  activeSub = undefined;
  try {
    cleanup();
  } finally {
    activeSub = prevSub;
  }
};

function effectScopeOper(this: EffectScopeNode): void {
  this.flags = ReactiveFlags.None;
  disposeAllDepsInReverse(this);
  const sub = this.subs;
  if (sub !== undefined) {
    unlink(sub);
  }
}

function effectOper(this: EffectNode): void {
  effectScopeOper.call(this);
  if (this.cleanup) {
    runCleanup(this);
  }
}

const updateComputed = (c: ComputedNode): boolean => {
  if (c.flags & HasChildEffect) {
    let link = c.depsTail;
    while (link !== undefined) {
      const prev = link.prevDep;
      const dep = link.dep;
      if (!("getter" in dep) && !("currentValue" in dep)) {
        unlink(link, c);
      }
      link = prev;
    }
  }
  c.depsTail = undefined;
  c.flags = ReactiveFlags.Mutable | ReactiveFlags.RecursedCheck;
  const prevSub = setActiveSub(c);
  try {
    ++cycle;
    const oldValue = c.value;
    const newValue = c.getter(oldValue);
    if (newValue instanceof LazyPromise) {
      return updateLPComputed(c, newValue);
    }
    return oldValue !== (c.value = newValue);
  } finally {
    activeSub = prevSub;
    c.flags &= ~ReactiveFlags.RecursedCheck;
    purgeDeps(c);
  }
};

const run = (e: EffectNode): void => {
  const flags = e.flags;
  if (
    flags & ReactiveFlags.Dirty ||
    (flags & ReactiveFlags.Pending && checkDirty(e.deps!, e))
  ) {
    if (flags & HasChildEffect) {
      let link = e.depsTail;
      while (link !== undefined) {
        const prev = link.prevDep;
        const dep = link.dep;
        if (!("getter" in dep) && !("currentValue" in dep)) {
          unlink(link, e);
        }
        link = prev;
      }
    }
    if (e.cleanup) {
      runCleanup(e);
      if (!e.flags) {
        return;
      }
    }
    e.depsTail = undefined;
    e.flags = ReactiveFlags.Watching | ReactiveFlags.RecursedCheck;
    const prevSub = setActiveSub(e);
    try {
      ++cycle;
      ++runDepth;
      const result = e.fn();
      if (result instanceof LazyPromise) {
        activeSub = undefined;
        const lpSub = result.subscribe<any>();
        e.cleanup = () => {
          lpSub.dispose();
        };
      } else {
        e.cleanup = result;
      }
    } finally {
      --runDepth;
      activeSub = prevSub;
      e.flags &= ~ReactiveFlags.RecursedCheck;
      purgeDeps(e);
    }
  } else if (e.deps !== undefined) {
    e.flags = ReactiveFlags.Watching | (flags & HasChildEffect);
  }
};

const autoFlush = (): void => {
  autoFlushScheduled = false;
  // eslint-disable-next-line no-use-before-define
  flush();
};

const scheduleFlush = (): void => {
  if (!autoFlushScheduled) {
    autoFlushScheduled = true;
    queueMicrotask(autoFlush);
  }
};

export const flush = (): void => {
  try {
    // Drain signal queue first - update all pending signal values
    while (signalNotifyIndex < signalQueuedLength) {
      const signal = signalQueued[signalNotifyIndex]!;
      signalQueued[signalNotifyIndex++] = undefined;
      if (updateSignal(signal)) {
        const subs = signal.subs;
        if (subs !== undefined) {
          shallowPropagate(subs);
        }
      }
      signal.queued = false;
    }

    // All signals are now committed. Reset the signal queue counters so
    // that lazy computed re-evaluation is allowed during the effect phase.
    // Without this, `computedOper`'s `signalQueuedLength === 0` guard
    // would incorrectly block re-evaluation of Pending computeds that are
    // reached through diamond dependency paths.
    signalNotifyIndex = 0;
    signalQueuedLength = 0;

    // Then drain effect queue
    while (notifyIndex < queuedLength) {
      const effect = queued[notifyIndex]!;
      queued[notifyIndex++] = undefined;
      run(effect);
    }
  } finally {
    // Signals written by effects during loop #2 were appended after loop #1 finished,
    // so loop #1 never cleared their queued flag. Do it now so future writes can re-queue them.
    while (signalNotifyIndex < signalQueuedLength) {
      const signal = signalQueued[signalNotifyIndex]!;
      signalQueued[signalNotifyIndex++] = undefined;
      signal.queued = false;
    }
    while (notifyIndex < queuedLength) {
      const effect = queued[notifyIndex]!;
      queued[notifyIndex++] = undefined;
      effect.flags |= ReactiveFlags.Watching | ReactiveFlags.Recursed;
    }
    signalNotifyIndex = 0;
    signalQueuedLength = 0;
    pendingTriggers = 0;
    notifyIndex = 0;
    queuedLength = 0;
  }
};

function computedOper<T>(this: ComputedNode<T>): T {
  const flags = this.flags;
  // Update computed on read only when no pending signal or trigger updates
  if (
    signalQueuedLength === 0 &&
    pendingTriggers === 0 &&
    (flags & ReactiveFlags.Dirty ||
      (flags & ReactiveFlags.Pending &&
        (checkDirty(this.deps!, this) ||
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
          ((this.flags = flags & ~ReactiveFlags.Pending), false))))
  ) {
    if (updateComputed(this)) {
      const subs = this.subs;
      if (subs !== undefined) {
        shallowPropagate(subs);
      }
    }
  } else if (!flags) {
    // First initialization - run the getter
    this.flags = ReactiveFlags.Mutable | ReactiveFlags.RecursedCheck;
    const prevSub = setActiveSub(this);
    try {
      const newValue = this.getter();
      if (newValue instanceof LazyPromise) {
        const state: LPState = {
          original: newValue,
          pendingHead: undefined,
          originalSub: undefined,
          status: undefined,
          result: undefined,
        };
        this.lp = state;
        this.value = new LazyPromise(
          new ProxyProducer(state, this),
        ) as unknown as T;
      } else {
        this.value = newValue;
      }
    } finally {
      activeSub = prevSub;
      this.flags &= ~ReactiveFlags.RecursedCheck;
    }
  }
  const sub = activeSub;
  if (sub !== undefined) {
    link(this, sub, cycle);
    // If this was the first initialization of an LP-computed, subscribe to the
    // original now that c.subs is linked. This ensures a synchronously-settling
    // original can set hasCachedValue correctly (the c.subs guard in
    // OriginalConsumer.resolve requires c.subs to be set first). For untracked
    // reads, ProxyProducer.produce handles the subscription.
    if (!flags && this.lp !== undefined) {
      subscribeToOriginal(this.lp, this, this.lp.original);
    }
  }
  return this.value!;
}

function signalOper<T>(this: SignalNode<T>, ...value: [T]): T | void {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (value.length) {
    // Write: queue the signal for deferred propagation on flush
    if (this.pendingValue !== (this.pendingValue = value[0])) {
      this.flags = ReactiveFlags.Mutable | ReactiveFlags.Dirty;
      // Queue this signal if not already queued
      if (!this.queued) {
        this.queued = true;
        signalQueued[signalQueuedLength++] = this;
        scheduleFlush();
      }
      const subs = this.subs;
      if (subs !== undefined) {
        propagate(subs, !!runDepth);
      }
    }
  } else {
    // Read: return stale value until flush
    const sub = activeSub;
    if (sub !== undefined) {
      link(this, sub, cycle);
    }
    return this.currentValue;
  }
}

export const isSignal = (fn: () => void): boolean =>
  fn.name === "bound " + signalOper.name;

export const isComputed = (fn: () => void): boolean =>
  fn.name === "bound " + computedOper.name;

export const isEffect = (fn: () => void): boolean =>
  fn.name === "bound " + effectOper.name;

export const isEffectScope = (fn: () => void): boolean =>
  fn.name === "bound " + effectScopeOper.name;

export function signal<T>(): {
  (): T | undefined;
  (value: T | undefined): void;
};
export function signal<T>(initialValue: T): {
  (): T;
  (value: T): void;
};
export function signal<T>(initialValue?: T): {
  (): T | undefined;
  (value: T | undefined): void;
} {
  return signalOper.bind({
    currentValue: initialValue,
    pendingValue: initialValue,
    subs: undefined,
    subsTail: undefined,
    flags: ReactiveFlags.Mutable,
  }) as () => T | undefined;
}

export const computed = <T>(getter: (previousValue?: T) => T): (() => T) =>
  computedOper.bind({
    value: undefined,
    subs: undefined,
    subsTail: undefined,
    deps: undefined,
    depsTail: undefined,
    flags: ReactiveFlags.None,
    getter: getter as (previousValue?: unknown) => unknown,
  }) as () => T;

export const effect = <T>(
  fn: () =>
    | void
    | (() => void)
    | (Extract<T, ErrorBox<any>> extends never ? LazyPromise<T> : never),
): (() => void) => {
  const e: EffectNode = {
    fn: fn as () => (() => void) | LazyPromise<any> | void,
    cleanup: undefined,
    subs: undefined,
    subsTail: undefined,
    deps: undefined,
    depsTail: undefined,
    flags: ReactiveFlags.Watching | ReactiveFlags.RecursedCheck,
  };
  const prevSub = setActiveSub(e);
  if (prevSub !== undefined) {
    link(e, prevSub, 0);
    prevSub.flags |= HasChildEffect;
  }
  try {
    ++runDepth;
    const result = e.fn();
    if (result instanceof LazyPromise) {
      activeSub = undefined;
      const lpSub = result.subscribe<any>();
      e.cleanup = () => {
        lpSub.dispose();
      };
    } else {
      e.cleanup = result;
    }
  } finally {
    --runDepth;
    activeSub = prevSub;
    e.flags &= ~ReactiveFlags.RecursedCheck;
  }
  return effectOper.bind(e);
};

export const effectScope = (fn: () => void): (() => void) => {
  const e: EffectScopeNode = {
    deps: undefined,
    depsTail: undefined,
    subs: undefined,
    subsTail: undefined,
    flags: ReactiveFlags.Mutable,
  };
  const prevSub = setActiveSub(e);
  if (prevSub !== undefined) {
    link(e, prevSub, 0);
    prevSub.flags |= HasChildEffect;
  }
  try {
    fn();
  } finally {
    activeSub = prevSub;
  }
  return effectScopeOper.bind(e);
};

export const trigger = (fn: () => void) => {
  const sub: ReactiveNode = {
    deps: undefined,
    depsTail: undefined,
    flags: ReactiveFlags.Watching,
  };
  const prevSub = setActiveSub(sub);
  try {
    fn();
  } finally {
    activeSub = prevSub;
    sub.flags = ReactiveFlags.None;
    let link = sub.deps;
    if (link !== undefined) {
      ++pendingTriggers;
      scheduleFlush();
    }
    while (link !== undefined) {
      const dep = link.dep;
      link = unlink(link, sub);
      const subs = dep.subs;
      if (subs !== undefined) {
        propagate(subs, !!runDepth);
        shallowPropagate(subs);
      }
    }
  }
};
