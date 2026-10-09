# Dual

**Commands.** Turbo caches package checks; fixes are never cached. The test runner owns its fingerprints, cache and continuation, so add no outer Vite+ cache around service-dependent tests.

```bash
vp run --workspace-root check
vp run --workspace-root --no-cache fix
vp run --workspace-root test
```

**VPN.** GitLab requires the Datapizza VPN, which runs only on dev; other machines use dev's route. Check reachability and reconnect when it expires; on `desktop`, run the reconnect through `ssh mp281x@dev`. Show the returned sign-in URL as a full URL under **Needs you**, directly after the result, then check again.

```bash
curl -fsS --max-time 5 https://git.datapizza.tech/users/sign_in >/dev/null || {
  openvpn3 session-manage --config datapizza --disconnect
  openvpn3 session-start --config datapizza --background
  openvpn3 session-auth
}
```

**Preview.** The preview runs development watchers, so it serves iteration only; Dual has no production preview command for release proof yet. `vp run --workspace-root preview` creates an isolated Alchemy stage derived from the checkout path. The stage holds the ports, database, sandbox, migrations, administrator and the app, API and worker watchers. Two threads in one worktree share its stage.

- **Sign-in.** Sign in as `admin@dual.local` with `preview-password`. AI journeys need provider connections.
- **Exposure.** The printed `.localhost` URL is machine-local, and Vite answers 403 to the tailnet host. Alchemy builds the app's environment, so `systemd-run --setenv` never reaches Vite. For a phone preview, edit `infra/saas/local.run.ts` without committing it: set `url` to `https://<host>:${environment.webPort}` and add `__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS: "<host>"` to `env`. Restart the preview, share the app port per environment's previews, and revert the edit before the push.
- **Lifetime.** Ctrl-C stops the preview and keeps its data. When every owner is settled and the data is disposable, `vp run --workspace-root preview:destroy` removes only that stage. Run it before you move or delete the checkout or its Alchemy state.
- **Live webhooks.** Funnel the API port's `/api/webhooks` path per environment's previews. `infra/saas/local.run.ts` sets `SERVER_PUBLIC_URL` to the local URL, so self-registering triggers need a temporary local override that is reverted before the push.
- **AI cost.** Every Architect run, chat turn and AI step in a preview uses `gpt-6-luna` at low reasoning effort.
- **Accounts.** Jira stays read-only per [Jira](#jira), and the user does any Jira configuration from a guide. Writes go only to GitHub `MP281X`, GitLab `matteopaludgnach` and the user's Discord test channel, whose messages can stay. Give the user a numbered guide to remove any Jira configuration they added for a test. The saved GitHub and Discord preview tokens are read-only; write tokens come from `gh auth token` and the `glab` configuration.
- **Never.** Never use the shared `init` or `dev` commands as a preview.

## Jira

Jira is Dual's only issue tracker: project `DOS`, board 1053, on `datapizza.atlassian.net`. The user's account ID is `712020:87e4f57e-6b5d-40ab-8dfa-faf159ead71a`.

**Read-only.** Agents must run only read commands: `view`, `search`, `list` and `acli jira auth status`. Never create, edit, assign, transition or comment on a ticket, and never change the sign-in. The user makes every change in Jira. Dual's `docs/agents/issue-tracker.md` lists write commands for the team; use only its read commands and its type hierarchy.

- **Assigned.** A ticket assigned to the user is work they just started. It is the reference for the task: read it whenever its key, such as `DOS-289`, appears in a request, branch or commit, and quote the requirements you use.
- **Unassigned.** Unassigned tickets form a shared pool that anyone on the team can pick from. Consider only those in the `To Do` status; skip `Backlog`, `Doing` and every other status.
- **Priority.** `P1` is the highest priority and `P4` the lowest. A higher priority must be done sooner.
- **Picking.** When the user asks what to work on, read every unassigned `To Do` ticket and rank them by priority, size and fit with the code. Areas and Initiatives group work; rank the Epics, Tasks, Stories and Bugs inside them. Decide with the user, then start workflow's Agree with the chosen ticket.
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

**CI.** The GitLab quality job runs a frozen install, the Effect-tsgo patch, then check, test and documentation. Read `docs/ci.md` for failures and `docs/releasing.md` for releases; a new push cancels interruptible pipelines. Check each package's Effect version in the lockfile before crossing adapter boundaries.

**Tracing.** The SaaS app optionally exports to PostHog, not Jaeger; see its Observability configuration.

## Coding standards

The `@deslop/coding-standards` package comes from deslop. Each package pins its own version, and each `oxlint.config.ts` keeps a legacy list: files whose `legacyRules` drop to warnings. Every file outside the legacy list and `ignorePatterns` passes the full preset.

- **Skills.** Run `vpx @deslop/coding-standards@latest` before code work. It refreshes the engineering, design and testing copies and changes no manifest or lockfile.
- **Bump.** When a task changes code, the stack's bottom cleanup layer runs `bun add --dev --exact @deslop/coding-standards@latest` in every package directory, then the root fix.
- **New rules.** A bump can add rules. When a new rule fails a listed file, add the rule to `legacyRules`. Fix every other failure in the cleanup layer, and remove the suppressions it no longer needs.
- **Touched files.** Each file outside `ignorePatterns` that the task adds or changes leaves the legacy list and passes the full preset. Refactor it completely, not only the changed lines.
- **Prune.** After the change, run the command below in the package directory. Remove every listed file it does not print. The list only shrinks: never add a file to it.
- **No blind refactors.** Never rewrite a listed file the task does not otherwise change, only to satisfy the rules.
- **Never linted.** Generated code, build output and shadcn primitives stay in `ignorePatterns`, never in the legacy list. Never lint or refactor a shadcn primitive, even one the task edits.

```bash
"$(git rev-parse --show-toplevel)"/node_modules/.bin/oxlint --format json . | jq -r '[.diagnostics[].filename] | unique[]'
```

- **Standards file.** Remove from Dual's `CODING_STANDARDS.md` what the shared skills already say. Keep the layout, tooling, stricter local choices and domain contracts.
