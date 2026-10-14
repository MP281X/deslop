---
name: testing
description: 'Select and run black-box behavior proof for Effect apps and tools. Use when choosing, writing, reviewing or running tests; apply engineering to test code and keep exploratory proof question-sized.'
---

# Testing

**Scope.** Test behavior the changed code owns; a coverage count proves nothing.

- **Worth it.** Retain a test only when it names owned behavior, a plausible wrong implementation, an independently known observable result and distinct protection. State what breaks without it. A green suite, coverage increase or extra case is not a reason to keep a test.
- **Public interface.** Test exported Layers, services and functions through observable behavior, so a rewrite that keeps the contract keeps the tests green. The browser proves web UI components; the simulator proves native ones.
- **Redundant.** Delete touched cases that only repeat dependency guarantees, constants, wording, removed behavior or a covered input. Keep boundary tests of the application's own validation, encoding or integration.
- **Independent.** Take expected values from the contract or a worked example, never from the implementation. Use the smallest reachable fixture that tells the cases apart.
- **Bugs.** Reproduce a bug before you fix it. Keep a regression case when future changes can plausibly break its contractual behavior, in the existing test of the fixed code or a new case when none fits. An independently reproduced defect does not require a new test file.
- **Throwaway.** Start with question-sized inline code, an existing test or a focused real-browser check. Delete the spike after it answers the question. Promote it only when its distinct regression protection meets Worth it; never add a private export or configurable production seam just for proof.
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
- **Audit.** Remove duplicate and tautological cases in the touched scope, but retain independent protocol, package, validation, authorization and persistence contracts. Mock call counts do not prove an external boundary. Do not replace a useful test with a disposable script just to reduce the count.

## Effect and fixtures

- **Entrypoint.** Plain `it` tests sync and Promise functions. `it.effect(name, () => effect)` runs with virtual services and `it.live` with real ones; return the Effect, with no runner wrapper. `it.layer` caches its block context and exposes `effect`, not `live`; shared live layers use `{excludeTestServices: true}`. Check APIs and imports against the cloned source.
- **Lifetime.** `it.effect` and `it.live` supply a Scope per case; `it.layer` acquisition belongs to its block. Use scoped platform resources and no redundant whole-case `Effect.scoped`. To assert cleanup, close the smaller operation scope before you inspect.
- **Isolation.** Shared layers share mutable services, `TestClock` and `TestConsole`, and `Layer.fresh` does not reset cached context. Use distinct keys, a public reset or case-local fixtures. Cases pass alone and together.
- **Clock.** Take `TestClock` and `TestConsole` from `effect/testing`. Fork, await a `Deferred` at the dependency boundary that carries the actual key or path, adjust time, then join; forking alone is not readiness. JavaScript timers, sockets and processes need live services.
- **Concurrency.** Give the dependency an entered and release pair: await entry, start the competing action, release, then assert the contract. Set `Effect.all` concurrency for overlap. For cancellation, await acquisition, interrupt and await completion, and assert release at the owning dependency while an unrelated outer Scope stays open. Joining an interrupted fiber alone does not prove resource release. Never test primitives or incidental ordering.
- **Boundary.** Double only dependencies outside the tested logic, through a Layer or a public parameter. A claim about an SDK, process, filesystem, HTTP, browser or package integration needs the real boundary, not mocks or spies.
- **Artifacts.** Prove a public tool with real packing and declared dependencies, not source imports or stubs. Generate fixtures with the real generator after one representative input settles; never alter expected output to fit a bug.
- **Platform.** `FileSystem.layerNoop` is not memory storage, and `HttpServer.layerServices` supplies no filesystem: use a platform Layer and scoped paths. `RpcTest` bypasses serialization, and `HttpApiTest` bypasses sockets but proves routing, encoding, middleware and decoding; neither proves deployment or an external integration.

## Run and reconcile

- **Run.** Use the documented test selectors, and confirm that they collect and run the intended cases. Zero collected tests, setup alone or exit code 0 alone prove nothing.
- **Inventory.** Collect independent failures in one run instead of stopping at the first, and tell separate cases from repeated observations. Rerun a timed-out test once in isolation; a pass proves that run, not the cause. Never call a bypassed selector or a skipped operation flaky.
- **Evidence.** Keep the first failure, exact command, execution count and exit status. Separate cause from hypothesis, product defect from setup failure, and a skipped criterion from a passing one. A source read or a green command never replaces a missing behavior check.
- **Final proof.** Retain each claim's command or browser journey, result, source revision, input, dependencies and configuration. Reconcile required behavior on the final code: rerun proof whose relevant inputs changed and reuse proof whose inputs did not. A steer invalidates dependent claims, not every check or capture. Required final repository gates still run. Use the actual built preview for final browser proof when the repository provides one. A command named preview that runs development watchers does not prove the production build. Screenshots and video prove visible outcomes; execution through the public interface proves the rest.
- **Visual proof.** Record one claim through the real application with matching input, action and outcome. Keep every meaningful step. A capture is stale once a component it shows changes. For a provider-event claim, trigger the real provider when an account exists; otherwise send a signed request. When only the user can do the provider-side step, prepare a guide.
