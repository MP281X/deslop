# Dual

Dual is a production SaaS in startup mode: requirements change often and anything can change, except that production data must keep working.

## Production data

- **Migrate, never reset.** Every change to a persisted shape ships a migration that converts existing rows: a renamed id, a stored enum value, a JSON column shape, a table. A schema change comes from `bun run db:generate` in `packages/server`; a data change is `bun run db:generate --custom --name <name>` filled with SQL that rewrites existing rows in place and skips rows already converted.
- **Prove it** on a local database seeded with the old shape: run the migration, then the changed journey. The user has no production database access; never make one a merge prerequisite.
- The new code reads only the new shape: no alias or dual read path.

## Commands

From the root. Checks, builds, tests and previews share one Turbo cache per worker, `~/dual/.turbo/cache`, across all its worktrees.

```bash
bun run fix && bun run check --affected && bun run test --affected   # fix (lint fixes, then format, branch files only), check, test
```

- **`--affected`** keeps the root tasks (format, scripts, infra, `test:release`) and runs only changed packages and their dependents against `TURBO_SCM_BASE`, which the agent environment sets to `origin/master`: about 40 package tasks for a typical branch instead of 276, and Turbo replays unchanged ones from cache. Never run them without `--affected` locally: each package runs a type-aware linter at 4–7 GB, a full run takes up to 30 minutes, and the pipeline runs it.
- **Generated:** root `codegen` (icons, agent docs), `bun --filter @dual/docs generate` (Fumadocs), `dual openapi-plugin` (internal plugins and their `turbo.json`).
- **Tests** start their own database containers. Run consumer acceptance and live release tests only when their contracts change.

## Jira

Project `DOS`, board 1053, on `datapizza.atlassian.net`; the user's account ID is `712020:87e4f57e-6b5d-40ab-8dfa-faf159ead71a`.

- **Picking.** When the user asks what to work on: rank only unassigned `To Do` tickets by priority (`P1` highest), size and fit with the code; skip every other status. Rank Epics, Tasks, Stories and Bugs, not Areas or Initiatives. After the user approves, assign each ticket to the user and move it to `Doing`; these are the only Jira writes.
- **Assigned.** A ticket key in a request, branch or commit means work the user started: read it and quote the requirements you use.

```bash
acli jira workitem search --csv --paginate --fields key,issuetype,priority,summary --jql 'project = DOS AND assignee is EMPTY AND status = "To Do" ORDER BY priority DESC, updated DESC'
acli jira workitem search --csv --fields key,priority,status,summary --jql 'project = DOS AND assignee = currentUser() AND statusCategory != Done'
acli jira workitem view DOS-289
acli jira workitem comment list --key DOS-289
acli jira workitem assign --key DOS-289 --assignee @me --yes
acli jira workitem transition --key DOS-289 --status Doing --yes
```

## VPN

`git.datapizza.tech` works only through dev's VPN route. When it does not answer, reconnect on dev (through `ssh mp281x@dev` from desktop), give the user the printed sign-in URL once, then check again:

```bash
curl -fsS --max-time 5 https://git.datapizza.tech/users/sign_in >/dev/null || {
  openvpn3 session-manage --config datapizza --disconnect
  openvpn3 session-start --config datapizza --background
  openvpn3 session-auth
}
```

## Preview

The `preview` project script runs `bun run preview` in its unit and builds an isolated Alchemy stage from the checkout path: database, sandbox, migrations, an administrator and app, API and worker watchers. It proves iteration, not a production build. Sign in as `admin@dual.local` with `preview-password`; AI journeys need provider connections.

- Source edits reload through the watchers. `stop` keeps containers and data; `bun run preview:destroy` (the settle cleanup) removes the stage. Run it before you move or delete a checkout.
- Live webhooks: funnel the API port's `/api/webhooks` per environment's Previews, with a temporary callback URL override reverted before the push.
- Never use the shared `init` or `dev` commands as a preview.
- **Accounts.** Writes go only to GitHub `MP281X`, GitLab `matteopaludgnach` and the user's Discord test channel. Saved preview tokens are read-only; write tokens come from `gh auth token` and the `glab` configuration.

## App

- **Dual Apps.** An app complements Dual's screens for one workflow, never a form or website builder. Whoever opens a workflow opens its apps; an invitation opens one app without workflow access. Apps share the company font, sizes and primary color; layout, spacing, size and radius vary per app. An app sends a notification or email only when Dual's workflows already send it.
- **Components** come from the shadcn primitives in `packages/ui/src/components`; add a missing one with `vpx shadcn@latest add <name> --cwd packages/ui`.
- **Frontend state.** Each feature defines its own `Atom.runtime(layer)` and mounts a `RegistryProvider`.
- **CI.** The GitLab quality job runs a frozen install, the Effect-tsgo patch, then check, test and docs in one Turbo graph; see `docs/ci.md` and `docs/releasing.md`. A new push cancels interruptible pipelines.
- **Tracing.** The SaaS exports to PostHog, not Jaeger.

## Coding standards

Each package pins its own `@deslop/coding-standards`; its `oxlint.config.ts` holds a legacy file list whose rules drop to warnings.

- **Skills** refresh into `.claude/skills` and `.agents/skills` through the worktree script `vpx @deslop/coding-standards@latest`, and stay tracked: commit each refresh.
- **Bump** only when the user asks: `bun add --dev --exact @deslop/coding-standards@latest` in every package directory, the root, the scaffold baseline and consumer fixtures, then `bun run fix`. A rule the bump breaks is turned off in that package's `oxlint.config.ts`, never inline.
- **Touched files.** A hand-written file the task adds or rewrites over half of leaves the legacy list and passes every rule. Other changed files stay listed; never refactor a file only for lint.
- **Prune** after the change: remove listed files that this command no longer prints.

  ```bash
  "$(git rev-parse --show-toplevel)"/node_modules/.bin/oxlint --format json . | jq -r '[.diagnostics[].filename] | unique[]'
  ```

- **Never linted:** generated code, build output and shadcn primitives (formatted only, never refactored). Everything is type-checked.
