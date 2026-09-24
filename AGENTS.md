## Validation

Environment: Debian 13.6 (trixie). Use dedicated tools first.

| Use                  | Tool              |
| -------------------- | ----------------- |
| Search text          | `rg`              |
| Process JSON         | `jq`              |
| Run JavaScript       | `node`            |
| Install dependencies | `vp install`      |
| Run scripts          | `vp run <script>` |
| Run package binaries | `vpx <binary>`    |

Vite Plus only; never invoke another package manager.

Select the smallest complete evidence for the affected behavior. Run `vp run fix` for repository formatting. Add `vp run check`, `vp run test`, builds, or direct observation when the change, a concrete failure, unresolved uncertainty, or affected shared behavior requires that proof. Broaden validation only for such evidence; do not repeat green checks mechanically.

When a selected project command is required, run it exactly with no flags, paths, partials, underlying tools, or substitutes.

## Product scope

- Target this environment and the user's personal-software workflow only.
- Select the smallest root fix. Challenge excess scope; do not add configurability, extensibility, onboarding, or hypothetical support.
- Releases are linear and squash-merged. Apply data changes at every merged pull request.
- Local data is disposable. Preserve production data only from the immediately previous release; delete obsolete data.
- Persist only irreducible canonical data and infer the rest. Remove superseded paths and adapters; preserve compatibility only when explicitly required.

`tools/workflow` owns the reusable agent workflow: `src/agents/claude/output-styles/pair.md` and the `developer_instructions` in `src/agents/codex/config.toml` are the pair-thread instructions, one copy per harness, edited identically. Agents that write or review product code apply its `engineering` skill with this repository's `project-engineering` skill.
