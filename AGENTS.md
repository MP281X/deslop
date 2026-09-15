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

Global conduct, communication, and specialist ownership are installed from `workflow/`. Apply the global `engineering` skill with this repository's `project-engineering` skill for product code.
