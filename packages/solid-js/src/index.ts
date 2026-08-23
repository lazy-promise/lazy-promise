import type {
  Consumer,
  InferDep,
  Producer,
  Sink,
  Subscription,
  Unbox,
  UnboxError,
} from "@lazy-promise/core";
import { LazyPromise } from "@lazy-promise/core";
import type { Owner } from "solid-js";
import { getOwner, runWithOwner, untrack } from "solid-js";

export const ownerSymbol = Symbol("owner");

/**
 * The dependency injected by the glue utility: the Solid owner that was current
 * when the glue utility was called.
 */
export interface OwnerDep {
  [ownerSymbol]: Owner | null;
}

const doneResult = { value: undefined, done: true as const };

const resolvedSymbol = Symbol("resolved");
const rejectedSymbol = Symbol("rejected");

class GlueIterator<Value> implements Consumer<Value> {
  subscription: Subscription | undefined;
  done = false;
  /** Set when the promise settles synchronously inside `subscribe`. */
  syncState: typeof resolvedSymbol | typeof rejectedSymbol | undefined;
  syncResult: unknown;
  resolveNext: ((result: IteratorResult<Value>) => void) | undefined;
  rejectNext: ((error: unknown) => void) | undefined;

  constructor(
    public lazyPromise: LazyPromise<Value, OwnerDep>,
    public owner: Owner | null,
  ) {}

  resolve(value: Value) {
    const resolveNext = this.resolveNext;
    if (!resolveNext) {
      this.syncState = resolvedSymbol;
      this.syncResult = value;
      return;
    }
    this.done = true;
    this.resolveNext = undefined;
    this.rejectNext = undefined;
    resolveNext({ value, done: false });
  }

  reject(error: unknown) {
    const rejectNext = this.rejectNext;
    if (!rejectNext) {
      this.syncState = rejectedSymbol;
      this.syncResult = error;
      return;
    }
    this.done = true;
    this.resolveNext = undefined;
    this.rejectNext = undefined;
    rejectNext(error);
  }

  // Bare (non-promise) results and the synchronously calling thenable below
  // take Solid's synchronous settle paths, which a real promise wouldn't.
  next(): any {
    if (this.done || this.subscription) {
      return doneResult;
    }
    this.subscription = runWithOwner(null, () =>
      untrack(() =>
        this.lazyPromise.subscribe<any>(this, { [ownerSymbol]: this.owner }),
      ),
    );
    if (this.syncState === resolvedSymbol) {
      this.done = true;
      return { value: this.syncResult, done: false };
    }
    if (this.syncState === rejectedSymbol) {
      this.done = true;
      const error = this.syncResult;
      return {
        then: (onResolve: unknown, onReject: (error: unknown) => void) => {
          onReject(error);
        },
      };
    }
    return new Promise((resolve, reject) => {
      this.resolveNext = resolve;
      this.rejectNext = reject;
    });
  }

  return(): any {
    this.done = true;
    // A pending next() promise is deliberately left unsettled: settling it
    // would feed Solid a value or completion for a flight it already closed.
    this.resolveNext = undefined;
    this.rejectNext = undefined;
    this.subscription?.dispose();
    return doneResult;
  }
}

class GlueIterable<Value> {
  constructor(
    public lazyPromise: LazyPromise<Value, OwnerDep>,
    public owner: Owner | null,
  ) {}

  [Symbol.asyncIterator](): GlueIterator<Value> {
    return new GlueIterator(this.lazyPromise, this.owner);
  }
}

// By using a named interface here, we're making TS show only the relevant error
// message in its error output.
interface Glue {
  /**
   * Converts a LazyPromise to an AsyncIterable that can be returned from a
   * Solid computation. The LazyPromise is subscribed in an untracked and
   * ownerless context when Solid first pulls the iterator, and unsubscribed
   * when Solid closes it (on re-run or disposal of the computation). The Solid
   * owner is injected as `OwnerDep`.
   */
  // `LazyPromise<any, never>` is the constraint satisfied by every LazyPromise;
  // the gate below produces the precise error.
  <Arg extends LazyPromise<any, never>>(
    lazyPromise: Arg &
      (UnboxError<Unbox<Arg>> extends never
        ? OwnerDep extends InferDep<Arg>
          ? unknown
          : "❌ The glue utility expects a LazyPromise that has no dependencies other than OwnerDep."
        : "❌ Unhandled boxed errors detected. Catch them before calling the glue utility."),
  ): AsyncIterable<Unbox<Arg>>;
}

export const glue: Glue = (lazyPromise: any) =>
  new GlueIterable(lazyPromise, getOwner());

export const noop: () => void = () => {};

class RunWithOwnerDepProducer implements Producer<any, OwnerDep> {
  constructor(public callback: () => any) {}

  produce(sink: Sink<any, OwnerDep>, dep: OwnerDep) {
    // May throw.
    sink.resolve(runWithOwner(dep[ownerSymbol], this.callback));
  }
}

/**
 * Returns a LazyPromise that runs the callback with the owner provided by
 * `OwnerDep` and resolves with the callback result.
 */
export const runWithOwnerDep = <Value>(
  callback: () => Value,
): LazyPromise<Unbox<Value>, OwnerDep & InferDep<Value>> =>
  new LazyPromise<any, OwnerDep>(new RunWithOwnerDepProducer(callback));
