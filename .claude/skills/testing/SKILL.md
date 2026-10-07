---
name: testing
description: 'Select and run black-box behavior proof for Effect apps/tools. Use when choosing, writing, reviewing or running tests; apply engineering to test code and keep exploratory proof question-sized.'
---

# Testing

**Scope.** Guard owned behavior, not coverage.

**Timing.** An experiment needs trustworthy proof of its question, not comprehensive release coverage. Final acceptance applies to retained delivery; label stubbed/unproved behavior.

- **Worth it.** Test owned branching, computation, parsing/state transitions a plausible regression breaks; add missing valuable coverage before refactoring.
- **Seam.** Test the exported layer, service, or function of a package or an app's service as a black box, so rewriting the implementation leaves every test green; the browser proves UI components.
- **Redundant.** Delete touched cases merely asserting types/schema rules, Effect/dependency/platform internals, wiring, constants/counts, wording, removed/unreachable behavior or an already-covered input.
- **Independent.** Expected values come from the contract/worked example, not implementation recomputation. Use the smallest reachable discriminating fixture.
- **Bugs.** Reproduce a bug before fixing it; its failing case stays only when the fixed logic meets this bar, in the existing test that covers the fixed code.
- **Throwaway.** Settle a worry with a throwaway test or prototype and delete it once answered.
- **Honest.** No wrong expectations or rule workarounds. Change assertions only for recorded behavior changes; preserve every still-relevant value.

**Assertions.** One representative input per behavior in its existing case; helpers serve every case. Use @effect/vitest assert for returned/flagged input or structured error identity. Doubles use Layers/public parameters, never vi/global/module mocks. Compose once; isolate state at its owning fixture.

```ts
// good — "test files only for the services/packages public interfaces"
it.layer(Layer.provideMerge(Ledger.layer, NodeServices.layer))(test => {
	test.effect('keeps the previous entries when the file is malformed', () => run(program))
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

- **Contract.** Reachable input → observable output; a plausible wrong implementation must fail. Use the nearest public seam, not private helpers/new harnesses. When behavior is uncertain, settle one reachable case with a focused check and minimal implementation, then choose the next case from the findings; do not batch tests for an imagined implementation or require universal TDD.
- **Branches.** Exercise reachable empty/duplicate/concurrent/dependency-failure distinctions; no Cartesian product or random/repeated happy paths without a hypothesis.
- **Failure.** Effect.flip for expected failure; Effect.exit for both outcomes. Assert domain identity and preserved state/resources: no partial write, lost value, extra retry or leak. Wording/rejection alone is insufficient; no incidental order assertions.
- **Control.** Run against the unfixed implementation: the intended assertion fails, not setup/import/compilation. For refactoring, add missing coverage on old behavior first. Keep durable regressions, remove settled probes.

## Effect and fixtures

- **Entrypoint.** Plain it: sync/Promise public functions. it.effect(name, () => effect): virtual services; it.live: real services. Return Effect from a callback, no runner wrapper. it.layer caches its block context and exposes effect, not live; shared live layers use {excludeTestServices: true}. Verify matched cloned-source APIs/imports.
- **Lifetime.** it.effect/live supply case Scope; it.layer acquisition belongs to its block. Use scoped platform resources, no redundant whole-case Effect.scoped. To assert cleanup, close the smaller operation scope before inspection.
- **Isolation.** Shared layers share mutable services/TestClock/TestConsole; Layer.fresh does not reset cached context. Distinct keys, public reset or case-local fixtures; cases pass alone/together, never depend on earlier output.
- **Clock.** TestClock/TestConsole from effect/testing. Fork, await a dependency-boundary Deferred carrying the actual key/path, adjust time, join; forking alone is not readiness. JavaScript timers/sockets/processes need live services, not TestClock.
- **Concurrency.** Dependency entered/release pair: await entry, start competing action, release, assert contract. Set Effect.all concurrency for overlap. Cancellation: await acquisition, interrupt and await completion; unrelated outer Scope stays open. Don't test primitives/incidental ordering.
- **Boundary.** Double only dependencies outside tested logic, via Layer/public parameter. SDK/process/filesystem/HTTP/browser/package integration claims require the real boundary, not matching mocks/spies.
- **Artifacts.** Public-tool proof uses real packing/declared dependencies, not source imports/stubs. Generate fixtures with the real generator after one representative input settles; never alter expected output to fit a bug.
- **Platform.** FileSystem.layerNoop is not memory storage; HttpServer.layerServices supplies no filesystem. Use platform Layer/scoped paths. RpcTest bypasses serialization; HttpApiTest bypasses sockets while testing routing/encoding/middleware/decoding. Neither proves deployment/external integration.

## Run and reconcile

- **Run.** Use the repository's check commands scoped to the affected packages, fix commands scoped to the files the change touches, and documented test selectors; confirm intended collection/execution. Zero tests/setup-only/exit0 alone is not proof; no invented final suite.
- **Inventory.** Collect independent failures once instead of cancelling the suite at the first failure. Distinguish separate cases from repeated observations. A timeout receives one isolated rerun of that same test; after a genuine pass, stop investigating it. Do not call a bypassed selector or a skipped operation flaky.
- **Evidence.** Preserve the first failure, exact command, execution count and exit status. Separate cause from hypothesis, product defect from setup failure, and a skipped criterion from a passing one. A source read or overall green command never substitutes for a missing behavior check.
- **Stable inputs.** No writer changes a running check's source, dependencies, configuration or build inputs. A relevant edit invalidates its prior result; rerun affected criteria and reuse unaffected evidence. Independent research or browser journeys may continue without mutating those inputs.
- **Final proof.** Reconcile every required behavior on the final code. Screenshots/video prove visible outcomes; public-seam execution proves nonvisual behavior; use fresh agents for changed instructions only when they can settle a consequential unresolved uncertainty, not routine wording edits. Keep the result and useful evidence, not disposable drivers, fixture installs, reports or unrequested preview services.
- **Visual proof.** A capture proves one claim and ends on its outcome, held long enough to read: the run, the file or the rejection. Seed data first, and keep loading states off camera unless loading is the claim. Show realistic journeys end to end, cropped to the element at a readable scale; speed up waits instead of cutting steps. A capture is stale once any component it shows changes.
