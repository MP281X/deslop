# Dual

**Commands.** Run these from the root. Checks, builds, tests and preview builds share Turbo cache entries, so a repeated root run reruns only what changed. `fix` fixes the branch's changes and untracked files, not the whole repository. `check` prints failing task logs in oxlint's agent format and hides legacy warnings. Add no outer Vite+ cache around service-dependent tests.

```bash
bun run check
bun run fix
bun run test
```

- **Removed scripts.** `check:prepare`, the package `fix` and barrel `codegen` scripts, `dev:*`, `migrations:cleanup` and `test:watch` are gone. Edit public `index.ts` exports by hand, run Vitest in a package for watch mode, and use the preview, whose startup runs migrations.
- **Generated.** Root `codegen` generates icons and agent documentation, and `bun --filter @dual/docs generate` builds the Fumadocs output. `dual openapi-plugin` writes `turbo.json` for internal plugins.
- **Tests.** Root `test` includes workspace tests, release tests and candidate packing; server tests need `.env.test`. Run consumer acceptance and live release tests separately when their contracts change.

**VPN.** GitLab requires the Datapizza VPN, which runs only on dev; other machines use dev's route. Check reachability and reconnect when it expires; on `desktop`, run the reconnect through `ssh mp281x@dev`. Give the returned sign-in URL as a guide under **Needs you**, then check again.

```bash
curl -fsS --max-time 5 https://git.datapizza.tech/users/sign_in >/dev/null || {
  openvpn3 session-manage --config datapizza --disconnect
  openvpn3 session-start --config datapizza --background
  openvpn3 session-auth
}
```

**Preview.** The preview runs development watchers, so it serves iteration only; Dual has no production preview command for release proof yet. `vp run --workspace-root preview` creates an isolated Alchemy stage derived from the checkout path. The stage holds the ports, database, sandbox, migrations, administrator and the app, API and worker watchers. Two threads in one worktree share its stage.

- **Sign-in.** Sign in as `admin@dual.local` with `preview-password`. AI journeys need provider connections.
- **Exposure.** Start the detached preview with `systemd-run --setenv=DUAL_PREVIEW_HOST=<tailnet host>`, a host name without scheme or port. It sets the app origin, sign-in URLs, the public server URL and Vite's allowed host. Share the printed app port on the same port per environment's previews. Turbo restarts a watcher only when its build inputs change.
- **Lifetime.** Ctrl-C stops the preview and keeps its data. When every owner is settled and the data is disposable, `vp run --workspace-root preview:destroy` removes only that stage. Run it before you move or delete the checkout or its Alchemy state.
- **Live webhooks.** Funnel the API port's `/api/webhooks` path per environment's previews. `SERVER_PUBLIC_URL` follows the preview's app URL, so a separate Funnel port needs a temporary callback URL override that is reverted before the push.
- **AI cost.** Every Architect run, chat turn and AI step in a preview uses `gpt-6-luna` at low reasoning effort.
- **Accounts.** Jira stays read-only per [Jira](#jira), and the user does any Jira configuration from a guide. Writes go only to GitHub `MP281X`, GitLab `matteopaludgnach` and the user's Discord test channel, whose messages can stay. Give the user a numbered guide to remove any Jira configuration they added for a test. The saved GitHub and Discord preview tokens are read-only; write tokens come from `gh auth token` and the `glab` configuration.
- **Never.** Never use the shared `init` or `dev` commands as a preview.

## Jira

Jira is Dual's only issue tracker: project `DOS`, board 1053, on `datapizza.atlassian.net`. The user's account ID is `712020:87e4f57e-6b5d-40ab-8dfa-faf159ead71a`.

**Read-only.** Agents must run only read commands: `view`, `search`, `list` and `acli jira auth status`. Never create, edit, assign, transition or comment on a ticket, and never change the sign-in. The user makes every change in Jira. Dual's `docs/agents/issue-tracker.md` lists write commands for the team; use only its read commands and its type hierarchy.

- **Assigned.** A ticket assigned to the user is work they just started. It is the reference for the task: read it whenever its key, such as `DOS-289`, appears in a request, branch or commit, and quote the requirements you use.
- **Unassigned.** Unassigned tickets form a shared pool that anyone on the team can pick from. Consider only those in the `To Do` status; skip `Backlog`, `Doing` and every other status.
- **Priority.** `P1` is the highest priority and `P4` the lowest. A higher priority must be done sooner.
- **Picking.** When the user asks what to work on, read every unassigned `To Do` ticket and rank them by priority, size and fit with the code. Areas and Initiatives group work; rank the Epics, Tasks, Stories and Bugs inside them. Decide with the user, then start workflow's Prepare with the chosen ticket.
- **Output.** Plain `view` prints the description as text, while `--json` returns Atlassian's document format. Searches read best as `--csv`.

```bash
acli jira workitem search --csv --paginate --fields key,issuetype,priority,summary --jql 'project = DOS AND assignee is EMPTY AND status = "To Do" ORDER BY priority DESC, updated DESC'
acli jira workitem search --csv --fields key,priority,status,summary --jql 'project = DOS AND assignee = currentUser() AND statusCategory != Done'
acli jira workitem view DOS-289
acli jira workitem comment list --key DOS-289
```

## App

**Components.** Build every screen from the shadcn primitives in `packages/ui/src/components`, including spinners, date pickers and form controls. Add a missing one with `vpx shadcn@latest add <name> --cwd packages/ui` after `vpx shadcn@latest list @shadcn --cwd packages/ui` and its docs. Never hand-build a control that a primitive covers.

**Frontend state.** Dual has no global atom runtime: each feature defines its own `Atom.runtime(layer)` and mounts a `RegistryProvider`. A task that changes a React Query hook or an Effect runner in React code moves it to an atom. `@effect/atom-react` declares `scheduler` below 0.28, so check its peer warning against the root override when you add it.

**CI.** The GitLab quality job runs a frozen install, the Effect-tsgo patch, then check in one Turbo graph, test and documentation. Read `docs/ci.md` for failures and `docs/releasing.md` for releases; a new push cancels interruptible pipelines. Check each package's Effect version in the lockfile before crossing adapter boundaries.

**Tracing.** The SaaS app optionally exports to PostHog, not Jaeger; see its Observability configuration.

## Coding standards

The `@deslop/coding-standards` package comes from deslop. Each workspace and infrastructure package pins its own version. Its `oxlint.config.ts` keeps a legacy list of files whose `legacyRules` drop to warnings, package-wide warning rules and rule disables; every other file passes the package's configured rules.

- **Skills.** Run `vpx @deslop/coding-standards@latest` before code work. It refreshes the engineering, design and testing copies in `.agents/skills` for Codex and `.claude/skills` for Claude, and changes no manifest or lockfile.
- **Bump.** When a task changes code, the stack's cleanup layer runs `bun add --dev --exact @deslop/coding-standards@latest` in every package directory, including infrastructure packages, the root, the scaffold baseline and consumer fixtures, then the root fix.
- **New rules.** A bump can add rules. When a new rule fails, turn it off in that package's `oxlint.config.ts`, never with inline disables; this overrides engineering's Disables rule. Remove obsolete rule entries and the suppressions the bump no longer needs.
- **Touched files.** Each hand-written file that the task adds or changes leaves the legacy list and the scoped React Query exemptions, and passes the package's configured rules. Refactor it completely, not only the changed lines: its data code moves to Effect Atom and its casts and suppressions go, unless the engineering skill allows one with its reason. Before each push, the command below must print nothing:

```bash
for p in packages/*/ infra/*/; do [ -f "$p/oxlint.config.ts" ] || continue; git diff --name-only --relative="$p" origin/master...HEAD | while read -r f; do grep -qF "\"$f\"" "$p/oxlint.config.ts" && echo "$p$f"; done; done
```

- **Prune.** After the change, run the command below in the package directory, without `--quiet`. Remove every listed file it does not print, and an import-ban exemption only after its imports are gone. The list only shrinks: never add a file to it.
- **No blind refactors.** Never rewrite a listed file the task does not otherwise change, only to satisfy the rules.
- **Never linted.** Generated code and build output get no lint rules or formatting, and shadcn primitives stay type-checked under an all-rules-off override; none of them goes in the legacy list. Never lint or refactor a shadcn primitive, even one the task edits. The hand-written color picker, data tables and file input stay linted.

```bash
"$(git rev-parse --show-toplevel)"/node_modules/.bin/oxlint --format json . | jq -r '[.diagnostics[].filename] | unique[]'
```

- **Standards file.** Remove from Dual's `CODING_STANDARDS.md` what the shared skills already say. Keep the layout, tooling, stricter local choices and domain contracts.
