---
name: lint-companion
description: Load before the first fix, check or test, and when a diagnostic survives a fix.
---

# Lint companion

**Converge.** Run Verify as written; let autofix handle mechanical rewrites and batch the remaining diagnostics. Use these examples when the corresponding diagnostic fires.

**Inline safely.** Preserve evaluation order and receiver binding:

```diff
-const value = store.get(key)
-return value
+return store.get(key)
```

**Order, not architecture.** A use-before-definition diagnostic needs the dependency moved, not a new module or a mutable placeholder:

```diff
-export function total(amount: number) { return fee(amount) + amount }
 export function fee(amount: number) { return amount * 0.2 }
+export function total(amount: number) { return fee(amount) + amount }
```

**Fix the cause.** If a diagnostic survives, inspect the applied diff and the rule's premise before changing the design. Delete a whole unused declaration, not just its header. Preserve resource lifetime.

**No camouflage.** No casts, wrappers, spreads, suppressions or file splits merely to pass. Use documented exceptions with their required reason. If the intended form is rejected, show it beside a genuinely invalid counterexample before changing policy.
