---
name: architecture
description: 'Choose the smallest production mechanism, module boundaries, state owners and failure contracts. Use for new features, consequential refactors and reviews of architectural complexity; engineering owns syntax and implementation conventions.'
---

# Architecture

Start from a real caller and the required outcome, not a pattern or framework. Apply engineering to the implementation. A new abstraction must remove a concrete obligation from its callers.

## Trace the operation

Read the nearest working feature and every affected consumer. Trace one successful operation and its strongest reachable failure through the existing modules. Identify the authoritative state, write boundary, resource lifetime and observable completion signal. Preserve the existing contracts that the change reaches.

Before code, settle these facts in the current plan, without creating another document:

- The caller's input, output and ordering obligations.
- One owner for each value, resource, side effect and failure.
- The existing module that can own the operation.
- The boundary where untrusted input becomes trusted data.
- What remains durable after interruption, and how the caller knows.

For a user-visible direction that remains open, decide it with the user before implementation; use orchestrator when available. Settle technical mechanisms with source, a disposable inline probe or a small executable prototype. Do not ask the user to choose between implementation details that evidence can rank.

## Choose the smallest mechanism

- **Existing shape.** Extend the canonical example from engineering's Patterns before creating a service, module or dependency. Keep domain code independent of transport and UI types.
- **Direct operation.** Prefer a function or existing service method. Add a service for a distinct capability or lifetime, not to rename a forwarded call. Add another backend only when a real consumer needs it.
- **Authoritative state.** Derive values from their owner. Do not mirror server state, request state, caches or pending results in another store. A persisted value has one write boundary.
- **Lifetime.** Keep finite request work in its request scope. A stream serves progressive results; it does not require a job system. Add background ownership only when work must survive the caller, with a real owner for stopping, recovery and completion.
- **Failure.** Handle failures the caller can reach. Validate at the boundary; retain domain identity, causes and completed work. Never turn failure into empty success or add blanket retries, fallbacks and catch-all defaults.
- **Retries.** For a contract that permits retry after an unknown write outcome, keep the request identity stable for one intent. Add no retry policy or idempotency machinery to operations that do not need that contract.
- **Boundaries.** Split code when dependencies, invariants or lifetimes differ. Prefer a substantive module to a chain of forwarding files. A small component or helper with one consumer stays beside that consumer.
- **Variations.** Use explicit variants for genuinely different behaviors. Do not add boolean combinations, a plugin registry, a generic configuration object or a universal factory for hypothetical callers.

Compare a new mechanism with the direct existing-module version. Count new state owners, boundaries, dependencies and failure paths, not just lines. Keep the simpler version unless a concrete contract rules it out. Prove that contract with a question-sized experiment; use a council only for a consequential unresolved tradeoff.

## Challenge the design

Try the strongest reachable counterexample: an interrupted write, repeated intent, stale response, overlapping caller or dependency failure. Check which owner preserves the invariant. Use testing to select evidence, not to turn every doubt into a permanent test.

Remove each mechanism whose deletion preserves the required outcomes, existing reachable contracts, security, accessibility and useful regression protection. Do not defend an abstraction because it is already implemented. State what breaks without it; if nothing breaks, remove it.
