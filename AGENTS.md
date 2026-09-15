## Validation

Environment: Debian 13.6 (trixie). Use dedicated tools first.

Use `node` for ad hoc scripting; never use Python.

| Use                  | Tool              |
| -------------------- | ----------------- |
| Search text          | `rg`              |
| Process JSON         | `jq`              |
| Run JavaScript       | `node`            |
| Install dependencies | `vp install`      |
| Run scripts          | `vp run <script>` |
| Run package binaries | `vpx <binary>`    |

Vite Plus only; never invoke another package manager.

| Changed files                 | Exact command                               |
| ----------------------------- | ------------------------------------------- |
| Only Markdown files changed   | `vp run fix`                                |
| Any non-Markdown file changed | `vp run fix && vp run check && vp run test` |

For these validation commands, use no flags, paths, partials, underlying tools, builds, or substitutes.

## Product scope

- Target this environment and the user's personal-software workflow only.
- Select the smallest root fix. Challenge excess scope; do not add configurability, extensibility, onboarding, or hypothetical support.
- Releases are linear and squash-merged. Apply data changes at every merged pull request.
- Local data is disposable. Preserve production data only from the immediately previous release; delete obsolete data.
- Persist only irreducible canonical data and infer the rest. Remove superseded paths and adapters; preserve compatibility only when explicitly required.

## Behavior

- **Authority:** User-approved objective and mutation boundary. Mutate assigned state only; preserve all other state.
- **Grounding:** Current source or configured read-only authoritative references for factual, causal, mechanism, dependency, and platform claims. Re-derive after changes; follow loaded instructions, skills, and references.
- **Delegation:** Delegator retains ownership; receiver's contract supplies method and output.
  - Fresh session: standalone payload; only applicable `Objective`, `Boundary`, `Decisions`, `Evidence`; no follow-up language.
  - Reused session: changed context only; include only changed applicable headings; omit unchanged facts and constraints.
- **Continuation:** Resolve recoverable failures through terminal outcome while no user action is required. Stop only at approved-boundary or state-safety risk, or when an outcome-changing fact cannot be established; report condition and impact.

## Communication

- **Content:** Outcomes, decisions, issues, required questions, applicable Git metadata only.
- **Shape:** Optimize scan cost over grammar. Fragments; leading labels; compact bullets, tables, or graphs; exact names, values, commands.
- **Order:** Context before dependent question; issues by impact.
- **Deduplicate:** One fact once. Omit clear, known, or reproducible explanation. Evidence only when inaccessible, ephemeral, conflicting, or issue-establishing.
- **Internal:** Omit coordination and alternative comparison. Preserve unresolved issues until resolved or transferred.
- **Sections:** Applicable sections only.
- **Vocabulary:** Input-only; do not mirror automatically.

| Word         | Explanation                                                            |
| ------------ | ---------------------------------------------------------------------- |
| `Workflow`   | The reusable process that governs how agents complete work             |
| `Aggressive` | Thoroughly pursue the approved outcome without expanding its scope     |
| `Deep pass`  | Inspect the complete approved scope, dependencies, and counterexamples |
| `Checkpoint` | Record completed work in Git after required implementation and proof   |
| `Centralize` | Give one responsible component ownership of shared policy              |
| `Slop`       | Unnecessary, vague, repetitive, generic, or low-value content          |

| Section    | Meaning                                                                                |
| ---------- | -------------------------------------------------------------------------------------- |
| `Findings` | One concise user-facing outcome, including decision-changing results when applicable   |
| `Git`      | Completed Git operation with only commit and pull-request data                         |
| `Issues`   | Unresolved defects, failures, risks, conflicts, or required actions, ordered by impact |
| `Blocked`  | Exact blocking condition and impact plus the minimum required input                    |
| `Next`     | Only the user action or question required to continue                                  |
