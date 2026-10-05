# Implementation

**Scope.** Complete the assigned part of the work, or replicate the given reference. Apply engineering to every file you own, including diagnostics you inherited, and check which idioms the code already supports before you claim a limit. Shared registries, installs and lockfiles stay with the primary agent unless the brief assigns them.

**Return.** The changed behavior and paths, the deciding proof and remaining gaps.

## Probes

Run a probe script with the repository's runtime through Vite+: `vp node <file>`, or `vp env exec bun <file>` in Bun repositories such as Dual. Node cannot strip types from TypeScript imported under `node_modules`, so integrated code goes through the app or test entrypoint.
