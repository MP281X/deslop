# Dual

**Commands.** Run these from the root. Checks, builds, tests and preview builds share Turbo cache entries, so a repeated run reruns only what changed. `fix` fixes the branch's changes and untracked files only. `check` prints failing task logs in oxlint's agent format and hides legacy warnings. Add no outer Vite+ cache around service-dependent tests.

```bash
bun run check
bun run fix
bun run test
```

- **Generated.** Root `codegen` generates icons and agent documentation; `bun --filter @dual/docs generate` builds the Fumadocs output; `dual openapi-plugin` writes `turbo.json` for internal plugins.
- **Tests.** Root `test` runs workspace tests, release tests and candidate packing; server tests need `.env.test`. Run consumer acceptance and live release tests separately when their contracts change.

**VPN.** When GitLab does not answer, reconnect the VPN on dev (from `desktop`, through `ssh mp281x@dev`). Give the returned sign-in URL as a guide under **Needs you**, then check again.

```bash
curl -fsS --max-time 5 https://git.datapizza.tech/users/sign_in >/dev/null || {
  openvpn3 session-manage --config datapizza --disconnect
  openvpn3 session-start --config datapizza --background
  openvpn3 session-auth
}
```

**Preview.** Dual has no production preview, so its preview proves only iteration. `vp run --workspace-root preview` creates an isolated Alchemy stage from the checkout path, with its own ports, database, sandbox, migrations, administrator, and app, API and worker watchers. Two threads in one worktree share its stage.

- **Sign-in.** `admin@dual.local` with `preview-password`. AI journeys need provider connections.
- **Exposure.** Start the detached preview with `systemd-run --setenv=DUAL_PREVIEW_HOST=<tailnet host>`, a host without scheme or port; it sets the app origin, sign-in URLs, the public server URL and Vite's allowed host. Share the printed app port per environment's Previews. Turbo restarts a watcher only when its build inputs change.
- **Lifetime.** Ctrl-C stops the preview and keeps its data. When every owner is settled and the data is disposable, `vp run --workspace-root preview:destroy` removes only that stage; run it before you move or delete the checkout.
- **Live webhooks.** Funnel the API port's `/api/webhooks` path per environment's Previews. `SERVER_PUBLIC_URL` follows the app URL, so a separate Funnel port needs a temporary callback URL override, reverted before the push.
- **Accounts.** Writes go only to GitHub `MP281X`, GitLab `matteopaludgnach` and the user's Discord test channel. The saved GitHub and Discord preview tokens are read-only; write tokens come from `gh auth token` and the `glab` configuration. The user configures Jira and removes test configuration himself, from a guide.
- **Never** use the shared `init` or `dev` commands as a preview.

## Jira

Jira is Dual's only issue tracker: project `DOS`, board 1053, on `datapizza.atlassian.net`. The user's account ID is `712020:87e4f57e-6b5d-40ab-8dfa-faf159ead71a`.

**Read-only.** Run only `view`, `search`, `list` and `acli jira auth status`. Never create, edit, assign, transition or comment on a ticket, and never change the sign-in. From Dual's `docs/agents/issue-tracker.md`, use only the read commands and the type hierarchy.

- **Assigned.** A ticket assigned to the user is work he started. Read it whenever its key, such as `DOS-289`, appears in a request, branch or commit, and quote the requirements you use.
- **Picking.** When the user asks what to work on, rank the unassigned tickets in `To Do` by priority (`P1` highest), size and fit with the code; skip every other status. Rank the Epics, Tasks, Stories and Bugs inside Areas and Initiatives. Decide with the user, then start software-factory's Prepare with the chosen ticket.
- **Output.** Plain `view` prints the description as text; `--json` returns Atlassian's document format. Use `--csv` for searches.

```bash
acli jira workitem search --csv --paginate --fields key,issuetype,priority,summary --jql 'project = DOS AND assignee is EMPTY AND status = "To Do" ORDER BY priority DESC, updated DESC'
acli jira workitem search --csv --fields key,priority,status,summary --jql 'project = DOS AND assignee = currentUser() AND statusCategory != Done'
acli jira workitem view DOS-289
acli jira workitem comment list --key DOS-289
```

## App

**Components.** Build every screen from the shadcn primitives in `packages/ui/src/components`, including spinners, date pickers and form controls. Add a missing one with `vpx shadcn@latest add <name> --cwd packages/ui` after you check `vpx shadcn@latest list @shadcn --cwd packages/ui` and its docs. Never hand-build a control that a primitive covers.

**Frontend state.** Dual has no global atom runtime: each feature defines its own `Atom.runtime(layer)` and mounts a `RegistryProvider`. `@effect/atom-react` declares `scheduler` below 0.28, so check its peer warning against the root override when you add it.

**CI.** The GitLab quality job runs a frozen install, the Effect-tsgo patch, then check, test and documentation in one Turbo graph. Read `docs/ci.md` for failures and `docs/releasing.md` for releases. A new push cancels interruptible pipelines. Check each package's Effect version in the lockfile before you cross adapter boundaries.

**Tracing.** The SaaS app can export to PostHog, not Jaeger; see its Observability configuration.

## Coding standards

Each workspace and infrastructure package pins its own `@deslop/coding-standards` version. Its `oxlint.config.ts` holds a legacy list of files whose `legacyRules` drop to warnings, package-wide warning rules and rule disables; every other file passes the configured rules.

- **Skills.** The worktree script runs `vpx @deslop/coding-standards@latest`, which refreshes the engineering, design and testing copies in `.agents/skills` and `.claude/skills`.
- **Bump.** When a task changes code, the cleanup pull request runs `bun add --dev --exact @deslop/coding-standards@latest` in every package directory, including infrastructure packages, the root, the scaffold baseline and consumer fixtures, then the root fix.
- **New rules.** When a rule from a bump fails, turn it off in that package's `oxlint.config.ts`, never with inline disables; this overrides engineering's Disables rule. Remove rule entries and suppressions that the bump made obsolete.
- **Touched files.** Each hand-written file that the task adds or changes leaves the legacy list and the scoped React Query exemptions, and passes the configured rules. Refactor it completely: its data code moves to Effect Atom, and its casts and suppressions go unless engineering allows one with a reason. Before each push, this command must print nothing:

```bash
for p in packages/*/ infra/*/; do [ -f "$p/oxlint.config.ts" ] || continue; git diff --name-only --relative="$p" origin/master...HEAD | while read -r f; do grep -qF "\"$f\"" "$p/oxlint.config.ts" && echo "$p$f"; done; done
```

- **Prune.** After the change, run the command below in the package directory, without `--quiet`. Remove each listed file that it does not print, and an import-ban exemption only after its imports are gone. Never add a file to the list.
- **No blind refactors.** Never rewrite a listed file that the task does not otherwise change.
- **Never linted.** Every source file, generated code and shadcn primitives included, is type-checked. Generated code and build output get no lint rules and no formatting. Shadcn primitives are formatted, with all lint rules off. None of them enters the legacy list. Never refactor a shadcn primitive, even one the task edits. The hand-written color picker, data tables and file input stay linted.

```bash
"$(git rev-parse --show-toplevel)"/node_modules/.bin/oxlint --format json . | jq -r '[.diagnostics[].filename] | unique[]'
```

- **Standards file.** Remove from Dual's `CODING_STANDARDS.md` what the shared skills already say. Keep the layout, tooling, stricter local choices and domain contracts.
