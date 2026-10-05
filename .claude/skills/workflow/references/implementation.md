# Implementation

**Scope.** Complete the assigned part of the work, or replicate the given reference. Apply engineering to every file you own, including diagnostics you inherited, and check which idioms the code already supports before you claim a limit. Shared registries, installs and lockfiles stay with the primary agent unless the brief assigns them.

**Return.** Return the changed behavior, the paths you changed, the proof that decides it and any gaps that remain.

## Standalone probes

Standalone probes use the existing runtime: write a `.mjs` driver, or pipe TypeScript through standard input from the target worktree's root:

```bash
node --input-type=module-typescript - < node_modules/.cache/deslop/<agent>/probe.ts
```

Imports in standard-input code resolve from the current directory, not from the driver's folder. Node cannot strip types from TypeScript imported under `node_modules`, so integrated code goes through the app or test entrypoint.
