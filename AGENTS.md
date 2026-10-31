# Deslop

Personal software for one user on two workers: Effect apps, their MCP tools and the shared `@deslop/coding-standards`.

## Scope

- No issue tracker: the request is the whole task.
- One user's software on these two workers: no portability, multi-user or compatibility code. Apps and MCP endpoints are public behind the shared sign-in at `auth.mp281x.xyz`; admins in `GITHUB_ADMINS` let other GitHub accounts in, and everyone with access shares each app's data.
- Releases are linear and squash-merged; a newer merge cancels an older release run, so a data change covers everything since the last successful deploy.
- Local data is disposable. Preserve production data only from the immediately previous release; delete obsolete data.

## Commands

- **Verify** is `vp check --fix && vp run check && vp run test`. `vp check --fix` formats, applies lint fixes and fails on what remains; the `check` task runs each package's `typecheck` and Fallow, and CI runs plain `vp check` before it; `test` runs each package's tests. Every `package.json` has the same `typecheck` and `test` scripts, and the root caches scripts, so an unchanged package replays from the local task cache. That cache is per worktree: the `vp test` and `vp check` keys contain the absolute path, so a new worktree starts cold.
- **Generators.** `vp create app -- --name <name>` (`--kind mobile` for iOS) and `vp create package -- --name <name>`, then `vp install`; never copy one. Before the first mobile push, follow `RELEASING.md`, **Publish an iOS app**.
- **Releases.** `RELEASING.md` covers Simulator builds, deploy and its checks, and publishing packages and iOS apps.
- **Agent configuration.** `.claude/agents/pair.md` and `.codex/instructions.md` replace the provider prompts and complement what the harness, T3 and tool descriptions already say: goals and local facts, never a restatement; where they conflict with an injected rule, they say so. They are identical from `# Work` down. Team skills live in `tools/coding-standards/skills/`, and `node tools/coding-standards/src/install.ts` refreshes their copies in `.claude/skills` and `.codex/skills`. The personal skills in `.claude/skills` (planning, environment, references) load globally through the workers' links; retrospective guidance is an environment reference.

## Patterns

| Pattern          | Owner and canonical example                                                                    |
| ---------------- | ---------------------------------------------------------------------------------------------- |
| Service          | `tools/create-package/template/`, `apps/stash/src/services/notes/`                             |
| Web app          | `tools/create-app/template/web/`: `apps/portfolio` behind a Deslop sign-in                     |
| Mobile app       | `tools/create-app/template/mobile/`, which mirrors `apps/stash`                                |
| RPC              | `apps/portfolio/src/rpcs/` and its client in `apps/portfolio/src/lib/utils.ts`                 |
| MCP tools        | `apps/scope/src/tools/`, served by `ServerRuntime.layerMcp` in `apps/scope/src/main.server.ts` |
| Web UI primitive | `packages/components-web/src/ui/`, added with `vpx shadcn@latest add` there                    |

## Documents

Each fact has one home: code, then lint, this file, `CODING_STANDARDS.md`, `RELEASING.md`, a published package's `README.md`, and the environment skill for the user's infrastructure; comments only for what a name cannot say.
