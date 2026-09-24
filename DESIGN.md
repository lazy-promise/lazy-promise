# Design notes for coding agents

Why `@lazy-promise/core` is built the way it is, and which alternatives were
considered and rejected. Behavior is documented on the site
(`packages/site/src/content/docs`, https://lazypromise.com); this file records
the reasoning so it does not get re-litigated. There are no compatibility constraints from earlier designs.

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
- Tracing interplay: span notifications run in the context of the code that
  caused them (the settle or dispose call), and only then is the context of
  `subscribe` restored, for the `run` calls and the work (`Chain.start`). This
  is what lets a tracer that sets up an `AsyncLocalStorage` store in `run`
  follow causality across async boundaries (`traceAsync.test.ts`). After
  restoring, the library re-enters the `run` of the frame that was active, if
  any, so that the context set up by `run` wins over the restored one
  everywhere, not just for the traced promise's direct consumer: an untraced
  `map` between two traced promises settles inside the upstream span's `run`
  and would otherwise cut the tracer's context chain
  (`Subscription.runInContextAndFrame`, `Chain.finishInFrame`). Skipping the
  restore whenever a `run` is active was rejected because attaching a tracer
  would then change the user's context in unrelated consumers.
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
`run(work, depth)`, `resolve`, `reject`, `flatten`, `unsubscribe`. `log` is a
tracer (`LogTracer`) attached to the same instance; attaching it twice reports
an error in a microtask.

Decisions:

- Spans observe the subscription from the outside. Redundant `sink` calls that
  are no-ops are invisible to tracers. When a producer resolves with a
  LazyPromise, the outer span stays open (its promise's value is the inner
  promise's value) and the inner LazyPromise's tracers add their spans to the
  same subscription. `flatten` goes only to the spans of the promise whose
  producer resolved: what happens inside the inner promise is its own business.
- The invariant to preserve: `sink.resolve(inner)` traces exactly like
  `inner.subscribe(sink)` would, plus the `flatten` entry and the extra depth
  it adds. That fixes the order of everything else: on settle, the spans of
  the current (innermost) LazyPromise are notified and its job is torn down
  inside their `run`, then the outer spans are notified and the consumer runs
  inside their `run`; on unsubscribe, oldest first, teardown innermost.
  `Subscription.olderSpans` marks where the current LazyPromise's spans end.
- Depth instead of physical nesting. `run(work, depth)` is called with the
  number of `run` frames logically enclosing the work. Within one event, a
  `Chain` visits the spans one at a time, and each span's `run` wraps only the
  part up to and including the next span's notification, the last one wrapping
  the actual work, so the `run`s of a chain are siblings, not nested. An
  event's chain does run inside whatever `run` is physically active when the
  event happens (a synchronous `sink.resolve` inside the producer's `run`), but
  that nesting is bounded because the trampoline loop unwinds it at each step.
  Stack depth is bounded no matter how long the synchronous causal chain is
  (see the "deep synchronous causality" test); the earlier design replayed the
  whole chain of `run`s around every trampoline step and overflowed.
- A single module-level `Frame` (innermost span + depth) is all the ambient
  state. The frame active when `sink.resolve` was called is captured
  (`Sink.frame`, `Subscription.pendingFrame`) and work that had to wait for the
  producer to return (the trampoline step after a flatten, the consumer of an
  untraced `map` over a traced promise) re-enters that one frame's `run`. So a
  notification may be followed by more than one `run` call, each with the same
  `depth`; a tracer must set up its state from `depth`, not by stacking on an
  enclosing `run` (`log` keeps the original `console.log` while any `run` is
  active). Passing `depth` to the notification handlers instead was rejected:
  it still leaves the untraced-`map` consumer with no span to wrap it.
- The `flatten` hook exists so that an asynchronous `sink.resolve(lazyPromise)`
  is treated like the other settlements: spans are notified, and the teardown
  plus the inner producer run inside their `run`. Without it that work ran
  outside any span. Re-entering `run` without a hook (a wrapped region with no
  cause visible to the tracer) and a separate wrapping `restore` hook were
  rejected as less legible.
- Tracers are trusted: no guards against `run` not calling `work` or handlers
  throwing. A throwing tracer breaks the traced program, by design.
- Tests: `log.test.ts` and `traceAsync.test.ts` pin behavior through logger
  output (the latter with an `AsyncLocalStorage`-based logger that shows the
  causal chain after async boundaries); `trace.test.ts` keeps only what a
  logger cannot show (types, partial spans, multiple tracers, detaching, `run`
  called in pieces, bounded stack depth).
- Untraced subscriptions take a separate code path with no closures (see
  AGENTS.md on V8 context allocation). The `...Traced` methods exist only for
  that reason.

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
- Generic round-tripping. For a bare type parameter `V`, `Unbox<LazyPromise<V,
D>>` resolves to `V` (matches on shape), but any conditional whose check type
  is `V` itself (`Unbox<V>`, `Exclude<V, ErrorBox<any>>`, `UnboxError<V>
extends ...`) stays deferred and is then assignable neither to nor from `V`.
  Consequences: pass-through operators (`catch`, `finally`, `race`, `defer`,
  `x.map(() => source)`) must return a naked `Value`, which every recipe relies
  on (`new LazyPromise<V, D>((sink, dep) => ....subscribe<any>(sink, dep))`);
  `box(v)`, `x.map(() => v)`, `subscribe()`, `toEager()`, `all([...])`, and
  `fromGen` pass-through cannot be expressed in generic code without a cast
  (plain `as LazyPromise<...>` is accepted and sound). A user constraint
  (`V extends Boxless`) does not make a deferred conditional resolve; TS only
  consults constraints when selecting overloads. A deferred result is accepted
  by an annotation only if it is spelled identically, so `map`/`catchBoxed`
  use `Extract`/`Exclude`/`UnboxError` rather than hand-written conditionals,
  letting users write `LazyPromise<string | Extract<V, ErrorBox<any>>, D>`.
- Rejected: normalizing `ErrorBox<"a"> | ErrorBox<"b">` to `ErrorBox<"a" |
"b">` in operator results (a `Result<V, E>` alias behaves the same). The two
  forms are mutually assignable, so the gain is cosmetic, and any such
  normalization is a conditional over `Value` that breaks the pass-through
  round-tripping above. A class constraint `Value extends Boxless` (brand key
  typed `never`) or a separate `Error` type parameter would remove the problem
  class but is a breaking redesign; a `resolve(value: Value | ErrorBox<Error>)`
  sink alone does not enforce box-free `Value` (the box is accepted through
  `Value`), and a tuple-guarded sink that does enforce it breaks
  `sink.resolve(genericValue)`.

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
