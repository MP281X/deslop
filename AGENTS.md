# Deslop

Personal software for one user on two workers: Effect apps, their MCP tools and the shared `@deslop/coding-standards`.

## Scope

- No issue tracker: the request is the whole task.
- One user's software on these two workers: no portability, multi-user or compatibility code. Apps and MCP endpoints use the shared sign-in at `auth.mp281x.xyz`, except the public Portfolio. Admins in `GITHUB_ADMINS` let other GitHub accounts in; everyone with access shares each app's data.
- Releases are linear and squash-merged; a newer merge cancels an older release run, so a data change covers everything since the last successful deploy.
- Local data is disposable. Preserve production data only from the immediately previous release; delete obsolete data.

## Commands

- **Verify**: `vp run fix && vp run test`. `fix` writes fixes and fails on leftovers; CI's `check` does not write. `vite.config.ts` owns the gate and per-worktree task cache.
- **Generators.** `vp create app -- --name <name>` (`--kind mobile` for iOS) and `vp create package -- --name <name>`, then `vp install`; never copy one. Before the first mobile push: `RELEASING.md`, **Publish an iOS app**.
- **Updates.** `vp update -r`; `vp outdated -r` then lists only pins. New checks since the last review: `@effect/tsgo`'s README table and changelog, each lint plugin's `rules` against its previous version, Fallow's release notes. Count a candidate rule's hits with `vp exec effect-tsgo --tsrs-lint vp lint -D <rule>`; ask before one that reverses a house form or rewrites hundreds of sites, with a bad/good pair and its count.
- **Releases.** `RELEASING.md`: Simulator builds, deploy and its checks, publishing packages and iOS apps.
- **Agent configuration.** `.claude/agents/pair.md` = `.codex/instructions.md` from `# Work` down. Skills live in `.claude/skills`; the environment skill owns installation and infrastructure. Change the installed `~/deslop` only through a merged PR, never while other threads use it.
- **Lint tactics.** If a diagnostic survives `fix`, run `vpx @deslop/coding-standards@latest`; its text lives in `tools/coding-standards/src/main.cli.ts`.

## Patterns

| Pattern          | Owner and canonical example                                                                                                                                                                                                               |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Service          | `tools/create-package/template/`, `apps/stash/src/services/notes/`                                                                                                                                                                        |
| Web app          | `tools/create-app/template/web/` for sign-in; `apps/portfolio` for a public app                                                                                                                                                           |
| Mobile app       | `tools/create-app/template/mobile/`, which mirrors `apps/stash`                                                                                                                                                                           |
| RPC              | `apps/portfolio/src/rpcs/` and its client in `apps/portfolio/src/lib/utils.ts`                                                                                                                                                            |
| MCP tools        | `apps/scope/src/tools/`, served by `ServerRuntime.layerMcp` in `apps/scope/src/main.server.ts`                                                                                                                                            |
| Web UI primitive | `packages/components-web/src/ui/` holds every Sera shadcn component; refresh with `vpx shadcn@latest add --all --overwrite` there, point `cn` imports at `#lib/utils.ts`, drop the `cn` dependency and fix only what the compiler rejects |
| iOS UI primitive | `packages/components-mobile/src/ui/`, named and split like the shadcn component it mirrors                                                                                                                                                |
| Software mark    | In `packages/components-web`, `vpx shadcn@latest add @svgl/<name>`; move generated `src/components/ui/svgs/` files into canonical `src/ui/svgs/`, keeping registry artwork                                                                |

## Documents

Each fact has one home: code, then lint; this file for repository operation, an app's `AGENTS.md` for product intent, `CODING_STANDARDS.md` for judgment, `DESIGN.md` for visual rules, the web/mobile theme for tokens, `RELEASING.md` for releases, a published package's `README.md` for its contract, skills for procedures and the PR template for reviewer-facing sections. Comments explain only what a name cannot say.
