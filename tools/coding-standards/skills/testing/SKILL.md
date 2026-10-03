---
name: testing
description: 'Curated black-box tests and trustworthy verification for Effect applications and tools. Read before writing, reviewing or running tests; apply engineering to the test code.'
---

# Testing

A few tests, each guarding logic worth guarding, beat coverage: every test is code to read and maintain.

- **Worth it.** Test logic the repository owns, its branching, computation, parsing, and state transitions, where a plausible regression breaks it and nothing else would catch it; touched logic worth a test that none covers gets a case, added before a refactor rewrites it.
- **Seam.** Test the exported layer, service, or function of a package or an app's service as a black box, so rewriting the implementation leaves every test green; the browser proves UI components.
- **Guaranteed elsewhere.** Leave untested types tsc checks, rules a schema declares, the Effect runtime, a dependency, the platform, another tool's output, wiring that only shows a call reaching a double, constants and pinned counts, wording, removed behavior, input no caller produces, and a second input for covered behavior; delete such cases in every test file the change edits.
- **Independent.** Expected values come from the brief or a worked example, never a recomputation of what the code does; fixtures are the inputs the request names, or the smallest reachable input that makes the logic decide.
- **Bugs.** Reproduce a bug before fixing it; its failing case stays only when the fixed logic meets this bar, in the existing test that covers the fixed code.
- **Throwaway.** Settle a worry with a throwaway test or prototype and delete it once answered.
- **Honest.** A test never expects wrong behavior or works around another rule; an expectation changes only with a recorded behavior change, and a changed assertion keeps every value the old one checked that still meets this bar.

**Assertions.** One input per behavior in the existing case that covers it; a test helper grows only when every case needs it; assert which input is flagged or returned, or an error's tag, code, or path, with `assert` from `@effect/vitest`; doubles are Layers or a dependency the public function takes, never vi, a global stub, or a module mock. Compose the dependency graph once; isolate case-specific state at its owning fixture.

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

- **Contract.** Name the behavior, its reachable input and observable output before writing a test. A case is worth keeping only when a plausible wrong implementation would fail it. Start at the nearest existing public seam, not a private helper or a new test harness.
- **Distinct branches.** Exercise empty, duplicate, concurrent and failing-dependency inputs only when real callers can produce them and owned logic treats them differently. One representative input for each distinct behavior, not a Cartesian product, repeated happy paths or random values without a hypothesis.
- **Failure state.** Use Effect.flip for an expected failure, or Effect.exit when both outcomes matter. Check the domain error's structured identity and the state a failure must preserve: no partial write, lost previous value, extra retry or leaked resource. Error wording and a rejected Promise alone do not prove the contract. Do not assert ordering the public contract does not promise.
- **Negative control.** For a bug, run the regression against the unfixed implementation and observe the intended failing assertion, not a compile/import/setup failure. For a refactor, add a missing valuable case on the old behavior first. A temporary experiment settles an unknown and is removed; only durable behavior stays in product tests.

## Effect and fixtures

- **Entrypoint.** Plain `it` runs synchronous or Promise-returning public functions. `it.effect(name, () => effect)` uses virtual services; `it.live(name, () => effect)` uses real time. Pass a callback returning the Effect, not the Effect itself or a runner wrapper. `it.layer(layer)` caches a shared context for its block; its callback provides `effect`, not a layer-aware `live`. For shared live services use `{excludeTestServices: true}`. Match package/lockfile versions to cloned upstream source before copying an API/import.
- **Lifetime.** it.effect and it.live supply a fresh case Scope. Resources acquired while building `it.layer` live for its block, not the case. Acquire temporary files/servers through real scoped platform operations; never wrap the whole case in Effect.scoped again. To assert owned cleanup before the case ends, close a smaller operation scope first, then inspect the resource.
- **Isolation.** Shared Layers also share mutable services, TestClock and TestConsole. Do not assume fresh state, zero time or empty console output per case; `Layer.fresh` does not undo the cached test context. Use distinct keys, a public reset or a case-local fixture when independence requires it. A test passes alone and beside the rest; earlier output is never setup.
- **Clock.** Import TestClock/TestConsole from `effect/testing`. Advance Effect time only after the operation reaches the relevant dependency; for arbitrary async work, fork, await a Deferred signalled with the actual key/acquired path at that boundary, adjust time and join. Use that typed value, not a void marker. Forking alone is not readiness. Virtual time does not drive JavaScript timers, sockets or external processes; those need the real boundary and live services.
- **Concurrency.** For owned race behavior, block the first operation at a dependency with an entered/release pair, await entry, start the competing action, then release and assert the promised result. Sequential Effect.all is not overlap; set concurrency when it is required. For cancellation, await acquisition before interrupting and await completion; an unrelated outer Scope does not close with the child. Never test Effect primitives or incidental internal order.
- **Doubles.** Replace only a dependency outside the behavior under test, through its service Layer or explicit public parameter. A deterministic dependency can produce success/failure without mocking the tested service. If the claim is actual SDK, process, filesystem, HTTP, browser or package integration, use that real boundary: a mocked response or matching spy call does not establish it.
- **Fixtures.** Keep the smallest reachable input beside the test. A published-tool proof uses a real packed artifact and its real declared dependencies, not source imports or stubbed packages. Generated fixtures come from the real generator after a representative input settles the changed template; do not hand-edit expected output to match a bug.
- **Platform.** FileSystem.layerNoop is partial/no-op behavior, not an in-memory filesystem; HttpServer.layerServices does not supply a real filesystem. Filesystem integration uses the appropriate platform Layer and scoped temporary paths. RpcTest proves handler/client interaction without serialization; HttpApiTest proves routing/encoding/middleware/decoding without a listening server. Neither proves sockets, deployment or an external service.

## Run and reconcile

- **Narrow first.** Run the touched behavior/file while changing it. Check that the selector actually collected and executed the intended test; zero tests, a setup-only pass or a process exiting zero is not a pass. Final repository checks use the repository's documented commands on stable inputs, not an invented second suite.
- **Inventory.** Collect independent failures once instead of cancelling the suite at the first failure. Distinguish separate cases from repeated observations. A timeout receives one isolated rerun of that same test; after a genuine pass, stop investigating it. Do not call a bypassed selector or a skipped operation flaky.
- **Evidence.** Preserve the first failure, exact command, execution count and exit status. Separate cause from hypothesis, product defect from setup failure, and a skipped criterion from a passing one. A source read or overall green command never substitutes for a missing behavior check.
- **Stable inputs.** No writer changes a running check's source, dependencies, configuration or build inputs. A relevant edit invalidates its prior result; rerun affected criteria and reuse unaffected evidence. Independent research or browser journeys may continue without mutating those inputs.
- **Final proof.** Reconcile every required behavior on the final code. Screenshots/video prove visible outcomes; public-seam execution proves nonvisual behavior; fresh agents prove changed agent instructions. Keep the result and useful evidence, not disposable drivers, fixture installs, reports or preview services.
