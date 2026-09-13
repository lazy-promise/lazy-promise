# Design notes

Why `@lazy-promise/core` is built the way it is, and which alternatives were
considered and rejected. Behavior is documented in the
[README](.github/README.md); this file records the reasoning so it does not get
re-litigated. There are no compatibility constraints from earlier designs.

## Settlement and teardown

Invariants: teardown runs at most once, and runs before anything is emitted
(also before the next producer runs when the producer resolves with a
LazyPromise).

Mechanics (`packages/core/src/lazyPromise.ts`):

- While the producer is running, `sink.resolve`/`sink.reject` only record the
  settlement on the `Sink`. Once the producer has returned, `Subscription.
runProducer` disposes the job and then delivers the recorded settlement. After
  the producer has returned, `sink.resolve`/`sink.reject` deliver directly.
- Resolving with a LazyPromise loops in `Subscription.next()` rather than
  recursing, so a chain of synchronous flattenings does not grow the stack.
  `Subscription.lazyPromise` is the LazyPromise whose producer runs next and
  doubles as the "loop continues" flag; `dispose()` clears it to end the loop.
- Because the core always disposes the job before emitting, combinators such as
  `all`/`any`/`race` do not dispose upstream themselves; `produce` just returns
  the job.
- A producer that throws after settling: the recorded settlement wins, the
  error is dropped. A producer that settles and then disposes its own
  subscription synchronously: nothing is emitted, the job is disposed.

`finally` deliberately does not run on cancellation; see the README Q&A.

## Async context

LazyPromise runs the producer, the consumer handlers, and the teardown in the
async context of the `subscribe` call. Implementation (`asyncResource.ts`):

- `process.getBuiltinModule("node:async_hooks").AsyncResource` is looked up
  once at import time. A `new AsyncResource("LazyPromise")` is created per
  subscription, but only when the producer returned without settling (a
  synchronous settlement cannot lose context). `Subscription.runInContext(
method, arg)` wraps delivery, flattening and teardown in `runInAsyncScope`.
- In browsers (`process.versions.node` absent) it is a no-op. In a Node-like
  runtime without `getBuiltinModule` the module throws at import: silent loss
  of context is worse than a loud failure. This sets `engines` to Node
  `^20.16.0 || >=22.3.0`; Deno 2.1+ and workerd provide the same API.
- No `@types/node` dependency: `process` is probed through a narrow local type.

Rejected:

- `AsyncLocalStorage.snapshot()` / `AsyncResource.bind()`: about 1 µs (Node
  22/24) to 3 µs (Node 20) per call because the bound function is decorated
  with `Object.defineProperties`; that was a ~100x slowdown of the synchronous
  micro-benchmarks. `new AsyncResource` + `runInAsyncScope` costs tens of
  nanoseconds and also needs no closure.
- A `Variable`/`Snapshot` ponyfill of the AsyncContext proposal inside core, or
  a `{capture, run}` adapter registry for framework-owned globals (Solid's
  owner, React transitions). Libraries can use `AsyncLocalStorage` today and
  native `AsyncContext` later; an emulation layer would diverge from native
  behavior at async boundaries and is a second thing to maintain. The proposal
  is also still at stage 2.

Subscribe-time capture matches `then`-time semantics of native promises and
fixes `all` leaking the context of whichever input resolved last.

## Tracing

`lazyPromise.trace(tracer)` attaches a `Tracer` whose `subscribe(dep,
subscription)` is called per subscription and may return a `Span` with optional
`run(work)`, `resolve`, `reject`, `flatten`, `unsubscribe`. `log` is a tracer
(`LogTracer`) attached to the same instance; attaching it twice reports an
error in a microtask.

Decisions:

- Spans observe the subscription from the outside. Redundant `sink` calls that
  are no-ops are invisible to tracers; when a producer resolves with a
  LazyPromise the outer span stays open and the inner LazyPromise's tracers add
  their spans to the same subscription.
- Ordering is causal. On settle, spans are notified newest first; on
  unsubscribe, oldest first. Each notification is followed by that span's `run`
  wrapping the consequent work (teardown, consumer, inner producer), so a
  tracer using `run` to maintain ambient state (OpenTelemetry-style) sees a
  consistent parent.
- Nesting is logical, not physical. A module-level `activeSpans` chain records
  which `run` frames are on the stack; the chain active when `sink.resolve`
  was called is captured (`Sink.activeSpans`, `Subscription.pendingSpans`) and
  replayed around the delivery or the next producer run in the trampoline
  loop. Without this, the loop in `next()` would flatten all nesting away.
- The `flatten` hook exists so that an asynchronous `sink.resolve(lazyPromise)`
  is treated like the other settlements: spans are notified, and the teardown
  plus the inner producer run inside their `run`. Without it that work ran
  outside any span. Re-entering `run` without a hook (a wrapped region with no
  cause visible to the tracer) and a separate wrapping `restore` hook were
  rejected as less legible.
- Tracer failures never affect the traced program: exceptions from tracer
  methods are rethrown in a microtask, and `run` is guarded so `work` executes
  exactly once even if the tracer forgets to call it or calls it twice.
- Untraced subscriptions take a separate code path with no closures (see
  AGENTS.md on V8 context allocation). The `...Traced` methods exist only for
  that reason.
- Known limitation: stack depth grows with the number of traced steps in a
  synchronous flatten chain (`runSpans`/`settleSpans` recurse).

## Type-level design

- `LazyPromise<out Value, in Dep>`. The `in Dep` annotation is load-bearing:
  without it `new LazyPromise<any>(...)` results fail assignability to
  specific-`Dep` return types, and `Sink<in Value, out Dep>`'s own variance
  check fails through the LazyPromise reference.
- `declare protected inferenceHelper: (dep: Dep) => void` gives `Dep` a
  strictly contravariant occurrence in the emitted `.d.ts`. `stripInternal`
  removes the internal `producer` field, which was the only such occurrence,
  and without one `InferDep` yields a union of deps instead of an intersection
  for generically inferred unions (`fromGen`'s `TYield`) consumed through the
  `.d.ts`. The same code imported from live `src` behaves correctly, which is
  why the bug was hard to see. A `UnionToIntersection` helper in `InferDep`
  also fixes it and was rejected as inelegant.
- `InferDep<T> = Extract<T, LazyPromise<any, never>> extends LazyPromise<any,
infer Dep> ? Dep : unknown`. `LazyPromise<any, never>` is the type every
  LazyPromise is assignable to under contravariant `Dep`; `LazyPromise<any,
any>` is not (`any` is not assignable to `never`) and would drop
  never-dep promises, hiding unsatisfiable dependency sets.
- Methods whose checks depend on `Value`/`Dep` (`inject`, `toEager`, `trace`)
  take `this: This` and express everything via `Unbox<This>`/`InferDep<This>`.
  A gate written directly in terms of `Dep` makes the resolved `this` types of
  different instantiations unrelated and breaks `LazyPromise<V, SomeDep>`
  assignability to `LazyPromise<any, any>` (surfacing far away, e.g. in
  `fromGen`'s constraint). Alternatives tested: non-generic `this` gates (fail
  assignability and trigger TS2636), `this`-conditional return types (illegal,
  TS2577), gates in rest-args or return types (fail or lose the message), a
  weak-type gate (`{} | {msg?: never}`; works but forces a single merged error
  message). Only the `This` form keeps distinct messages.
- `subscribe`'s dep arity is a conditional chain with `Dep` only in check
  positions. `undefined extends Dep ? ... : ...` puts `Dep` in the extends
  position, and TS's variance-annotation validator cannot relate two such
  deferred conditionals, producing a check-order-dependent false-positive
  TS2636 (editor-only, since the check is lazily cached). `undefined extends
null` detects `strictNullChecks: false`, where `dep` is optional for any
  `Dep` except `never`.
- Error messages are string literal types (`This & "❌ ..."`) rather than
  object types with a message key: the full sentence renders in both simple
  and union-receiver errors. Wrapping in a named alias was rejected because
  the alias name replaced the sentence in union errors. `subscribe` and
  `Yieldable` still use the object-key style; `Yieldable`'s key is a real
  property.
- `fromGen`: `TYield extends LazyPromise<any, any> & Yieldable = never`. The
  default matters when the generator has no `yield`: TS then falls back to the
  constraint, and an `any`-containing constraint poisons the whole return type.
  Displaying the result as `Unbox<TYield> | Unbox<TReturn>` rather than
  `Unbox<TYield | TReturn>` makes hovers show the resolved type.
- No unit test for hover text (via `ts.createLanguageService`): hover display is
  implementation-specific and the JS language-service API will not exist in
  the Go-based TypeScript 7. `expectTypeOf` pins semantics; hovers are checked
  manually after a rebuild.

## API scope

- `all`/`any` accept iterables and tuples only. Record inputs were removed: the
  types were too permissive and diverged from native `Promise`.
- No result sharing/caching, no separate typed-error channel, `map` rather than
  `then`/`flatMap`: see the README Q&A.
- Class-based `Producer`/`Job` API exists for library authors to avoid function
  allocation; the callback form is sugar over it.

## Performance

- Methods on the untraced hot path contain no closures, not even on branches
  that never execute; V8 allocates a context object for the whole method
  otherwise. Work that needs a closure lives in a separate `...Traced` method.
- `scripts/bench.mjs` compares the working tree against a git ref by running
  each variant in fresh processes and reporting the minimum, because JIT
  decisions vary per process. Use it before and after touching
  `lazyPromise.ts`.

## alien-signals package

Proof of concept for async signals on top of LazyPromise. Flushes in a
`queueMicrotask` scheduled automatically on write; a manual `flush` is not
exported so that there is one scheduling model. It is intentionally not kept in
step with core's async-context work.
