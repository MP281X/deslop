# Implementation

**Scope.** Complete the owned slice/reference replication. Apply engineering to every owned file, including inherited diagnostics; verify supported idioms before claiming limits. Shared registries/installs/lockfiles remain with the pair unless assigned.

**Return.** Return changed behavior/owned paths, decisive proof and unresolved gaps.

## Standalone probes

Standalone probes use the existing runtime: a `.mjs` driver, or TypeScript stdin from the target worktree root:

```bash
node --input-type=module-typescript - < node_modules/.cache/deslop/<agent>/probe.ts
```

Stdin imports resolve from the current directory, not the driver folder. Node cannot strip imported TypeScript under `node_modules`; integrated code uses the app/test entrypoint.
