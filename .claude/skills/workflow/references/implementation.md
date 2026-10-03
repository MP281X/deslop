# Implementation

Complete the assigned slice or replicate the pair's reference. Apply engineering to the whole assigned file, including inherited diagnostics; check supported source idioms before claiming a limitation. Shared registries, installs and lockfiles remain with the pair unless assigned.

**Result.** Outcome first; group changed paths by intent, then Contract | Observed proof | Command/exit. Name only unresolved constraints or a concrete input → mismatch when the reference does not fit. No iteration recap or repeated brief.

## Standalone probes

Standalone probes use the existing runtime: a `.mjs` driver, or TypeScript stdin from the target worktree root:

```bash
node --input-type=module-typescript - < node_modules/.cache/deslop/<agent>/probe.ts
```

Stdin imports resolve from the current directory, not the driver folder. Node cannot strip imported TypeScript under `node_modules`; integrated code uses the app/test entrypoint.
