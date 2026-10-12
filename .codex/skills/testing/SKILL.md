---
name: testing
description: 'Select and run black-box behavior proof for Effect apps and tools. Use when choosing, writing, reviewing or running tests; apply engineering to test code and keep exploratory proof question-sized.'
---

# Testing

**Scope.** Test behavior the changed code owns; a coverage count proves nothing.

- **Worth it.** Test owned branching, computation, parsing and state transitions that a plausible regression breaks.
- **Public interface.** Test exported Layers, services and functions through observable behavior, so a rewrite that keeps the contract keeps the tests green. The browser proves web UI components; the simulator proves native ones.
- **Redundant.** Delete touched cases that only repeat dependency guarantees, constants, wording, removed behavior or a covered input. Keep boundary tests of the application's own validation, encoding or integration.
- **Independent.** Take expected values from the contract or a worked example, never from the implementation. Use the smallest reachable fixture that tells the cases apart.
- **Bugs.** Reproduce a bug before you fix it. Keep the failing case when it protects owned behavior, in the existing test of the fixed code, or in a new case when none fits.
- **Throwaway.** Settle a question with a spike, and delete it once answered unless it becomes a regression test.
- **Honest.** No wrong expectations or rule workarounds. Change assertions only for recorded behavior changes, and keep every still-relevant value.

**Assertions.** Use one representative input per behavior, in its existing case. Share a helper only between cases that use it. Use @effect/vitest assertions for outputs and structured error identity. Replace dependencies through Layers or public parameters, never global or module mocks. Keep mutable state in its owning fixture.

```ts
// good — "test files only for the services/packages public interfaces"
it.layer(Layer.provideMerge(Ledger.layer, NodeServices.layer))(test => {
	test.effect('keeps the previous entries when the file is malformed', () => program)
})
assert.deepStrictEqual(customCodes(result.stdout), ['@deslop/coding-standards(no-typeof)'])
assert.containsSubset(error, {_tag: 'SandboxUnavailable', cause: killed})
Layer.succeed(OpenSandbox, openSandbox)
// bad — "1 userful test is better than 1000 useless ones"
it.effect('rejects an empty tag', () => run(ledger.add({tag: ''}))) // Schema.isNonEmpty already does
// bad — "this test is useless, it doesn't test that the agent is working"
it.effect('forwards the prompt', () => run(agent.prompt(message))) // wiring that only shows a call reaching a double
additional?: {name: string; source: string}[] // a helper option one case needs
it.effect('loads', () => pipe(program, Effect.provide(Ledger.layer))) // no owned behavior asserted
assert.isTrue(Array.some(diagnostics, d => d.code === 'typescript(TS2456)')) // another tool's output
expect(error).toMatchObject({_tag: 'SandboxUnavailable'}) // Vitest's expect
assert.strictEqual(Array.flatMap(attioProvider.groups, group => group.actions).length, 75) // a pinned count
```

## Choose cases

- **Contract.** Connect a reachable input to an observable output, so a plausible wrong implementation fails. Use no new harnesses. When behavior is uncertain, settle one reachable case with a focused check and a minimal implementation, then choose the next case from the findings. Never batch tests for an imagined implementation or require universal TDD.
- **Branches.** Exercise the reachable distinctions: empty, duplicate, concurrent and dependency failure. Write no Cartesian product, and no random or repeated happy paths without a hypothesis.
- **Failure.** Use `Effect.flip` for an expected failure and `Effect.exit` for both outcomes. Assert domain identity and preserved state and resources: no partial write, lost value, extra retry or leak. Wording or rejection alone is not enough, and incidental order is no assertion.
- **Control.** Run the regression test against the unfixed implementation, and confirm that the intended assertion fails, not setup, imports or compilation. Before a refactor, cover the old behavior.

## Effect and fixtures

- **Entrypoint.** Plain `it` tests sync and Promise functions. `it.effect(name, () => effect)` runs with virtual services and `it.live` with real ones; return the Effect, with no runner wrapper. `it.layer` caches its block context and exposes `effect`, not `live`; shared live layers use `{excludeTestServices: true}`. Check APIs and imports against the cloned source.
- **Lifetime.** `it.effect` and `it.live` supply a Scope per case; `it.layer` acquisition belongs to its block. Use scoped platform resources and no redundant whole-case `Effect.scoped`. To assert cleanup, close the smaller operation scope before you inspect.
- **Isolation.** Shared layers share mutable services, `TestClock` and `TestConsole`, and `Layer.fresh` does not reset cached context. Use distinct keys, a public reset or case-local fixtures. Cases pass alone and together.
- **Clock.** Take `TestClock` and `TestConsole` from `effect/testing`. Fork, await a `Deferred` at the dependency boundary that carries the actual key or path, adjust time, then join; forking alone is not readiness. JavaScript timers, sockets and processes need live services.
- **Concurrency.** Give the dependency an entered and release pair: await entry, start the competing action, release, then assert the contract. Set `Effect.all` concurrency for overlap. For cancellation, await acquisition, interrupt and await completion, and assert that an unrelated outer Scope stays open. Never test primitives or incidental ordering.
- **Boundary.** Double only dependencies outside the tested logic, through a Layer or a public parameter. A claim about an SDK, process, filesystem, HTTP, browser or package integration needs the real boundary, not mocks or spies.
- **Artifacts.** Prove a public tool with real packing and declared dependencies, not source imports or stubs. Generate fixtures with the real generator after one representative input settles; never alter expected output to fit a bug.
- **Platform.** `FileSystem.layerNoop` is not memory storage, and `HttpServer.layerServices` supplies no filesystem: use a platform Layer and scoped paths. `RpcTest` bypasses serialization, and `HttpApiTest` bypasses sockets but proves routing, encoding, middleware and decoding; neither proves deployment or an external integration.

## Run and reconcile

- **Run.** Use the documented test selectors, and confirm that they collect and run the intended cases. Zero collected tests, setup alone or exit code 0 alone prove nothing.
- **Inventory.** Collect independent failures in one run instead of stopping at the first, and tell separate cases from repeated observations. Rerun a timed-out test once in isolation; a pass proves that run, not the cause. Never call a bypassed selector or a skipped operation flaky.
- **Evidence.** Keep the first failure, exact command, execution count and exit status. Separate cause from hypothesis, product defect from setup failure, and a skipped criterion from a passing one. A source read or a green command never replaces a missing behavior check.
- **Final proof.** A check proves only the source, dependencies and configuration it ran on, so reconcile every required behavior on the final code. Screenshots and video prove visible outcomes; execution through the public interface proves the rest.
- **Visual proof.** A capture proves one claim and ends on its outcome, held long enough to read: the run, the file or the rejection. Seed data first, and keep loading states off camera unless loading is the claim. Show realistic journeys end to end, cropped to the element at a readable scale; speed up waits instead of cutting steps. A capture is stale once a component it shows changes.
