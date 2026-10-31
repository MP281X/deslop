# Deslop

Personal software for one user on two workers: Effect apps, their MCP tools and the shared `@deslop/coding-standards`.

## Scope

- No issue tracker: the request is the whole task.
- One user's software on these two workers: no portability, multi-user or compatibility code. Apps and MCP endpoints are public behind the shared sign-in at `auth.mp281x.xyz`; admins in `GITHUB_ADMINS` let other GitHub accounts in, and everyone with access shares each app's data.
- Releases are linear and squash-merged; a newer merge cancels an older release run, so a data change covers everything since the last successful deploy.
- Local data is disposable. Preserve production data only from the immediately previous release; delete obsolete data.

## Commands

- **Verify**: `vp check --fix && vp run check && vp run test`.
  - `vp check --fix`: format and lint fixes, fails on leftovers; CI runs plain `vp check`.
  - `check`: each package's `typecheck`, then Fallow. `test`: each package's tests.
  - **Task cache**: same `typecheck` and `test` scripts in every `package.json`, root caches scripts; per worktree, since `vp test` and `vp check` keys hold the absolute path.
- **Generators.** `vp create app -- --name <name>` (`--kind mobile` for iOS) and `vp create package -- --name <name>`, then `vp install`; never copy one. Before the first mobile push: `RELEASING.md`, **Publish an iOS app**.
- **Releases.** `RELEASING.md`: Simulator builds, deploy and its checks, publishing packages and iOS apps.
- **Agent configuration.**
  - `.claude/agents/pair.md` = `.codex/instructions.md` from `# Work` down; they replace the provider prompts with goals and local facts the harness, T3 and tool descriptions don't say, and name each injected rule they override.
  - **Team skills**: `tools/coding-standards/skills/`; `node tools/coding-standards/src/install.ts` refreshes `.claude/skills` and `.codex/skills`.
  - **Personal skills**: planning and environment in `.claude/skills`, loaded globally through the workers' links.

## Patterns

| Pattern          | Owner and canonical example                                                                                                                                |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Service          | `tools/create-package/template/`, `apps/stash/src/services/notes/`                                                                                         |
| Web app          | `tools/create-app/template/web/`: `apps/portfolio` behind a Deslop sign-in                                                                                 |
| Mobile app       | `tools/create-app/template/mobile/`, which mirrors `apps/stash`                                                                                            |
| RPC              | `apps/portfolio/src/rpcs/` and its client in `apps/portfolio/src/lib/utils.ts`                                                                             |
| MCP tools        | `apps/scope/src/tools/`, served by `ServerRuntime.layerMcp` in `apps/scope/src/main.server.ts`                                                             |
| Web UI primitive | `packages/components-web/src/ui/`, added with `vpx shadcn@latest add` there; point its `cn` import at `#lib/utils.ts` and drop the `cn` dependency it adds |
| iOS UI primitive | `packages/components-mobile/src/ui/`, named and split like the shadcn component it mirrors                                                                 |

## Documents

Each fact has one home: code, then lint, this file, `CODING_STANDARDS.md`, `DESIGN.md` for every visual token and rule, `RELEASING.md`, a published package's `README.md`, and the environment skill for the user's infrastructure; comments only for what a name cannot say.
