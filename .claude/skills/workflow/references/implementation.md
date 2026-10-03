# Implementation

**Scope.** Complete the owned slice/reference replication. Apply engineering to every owned file, including inherited diagnostics; verify supported idioms before claiming limits. Shared registries/installs/lockfiles remain with the pair unless assigned.

## Result

- **Outcome.** Changed behavior, then owned paths in reading order.
- **Proof.** Contract | Observed outcome | Command/exit; keep failures/skips explicit.
- **Constraints.** Only unresolved gaps; incompatible reference means concrete input → mismatch, not silent redesign. No iteration recap/repeated brief.

## Standalone probes

Standalone probes use the existing runtime: a `.mjs` driver, or TypeScript stdin from the target worktree root:

```bash
node --input-type=module-typescript - < node_modules/.cache/deslop/<agent>/probe.ts
```

Stdin imports resolve from the current directory, not the driver folder. Node cannot strip imported TypeScript under `node_modules`; integrated code uses the app/test entrypoint.
