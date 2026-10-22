# Deslop

Personal software for one user on two workers: Effect apps, their MCP tools and the shared `@deslop/coding-standards`. Judgement calls live in [CODING_STANDARDS.md](CODING_STANDARDS.md): read it before an unfamiliar shape; review cites it.

## Scope

- No issue tracker: the request is the whole task.
- No portability, multi-user or compatibility code: one user on these two workers. Apps and MCP endpoints are public, with shared authentication through `auth.mp281x.xyz`; `GITHUB_USERS` is an allowlist, not an invitation to add multi-user data.
- Releases are linear and squash-merged; a newer merge cancels an older release run, so a data change covers everything since the last successful deploy.
- Local data is disposable. Preserve production data only from the immediately previous release; delete obsolete data.

## Commands

- **Verify** is `vp run -w fix && vp run -w test`. `fix` is the whole static gate (lint fixes, types, format, Fallow), which CI runs without writes as `check`; test runs after it because rule tests create fixtures that a concurrent type scan reads.
- **Generators.** `vp create app -- --name <name>` (`--kind mobile` for iOS) and `vp create package -- --name <name>`, then `vp install`; never copy one. A new mobile app then takes the EAS project id from `npx eas-cli init` in `app.config.ts`, and after its first store build `submit.production.ios.ascAppId` in `eas.json`.
- **Agent configuration.** `.claude/agents/pair.md`, `.codex/instructions.md` and `.opencode/agents/build.md` are identical from `# Work` down, except the HTML kit, which only harnesses that render HTML carry. Team skills live in `tools/coding-standards/skills/`, and `node tools/coding-standards/src/install.ts` refreshes their copies in `.claude/skills`, `.codex/skills` and `.opencode/skills`. The personal skills in `.claude/skills` (orchestrator, environment, patterns, retrospective) load globally through the workers' links.

## Patterns

| Pattern          | Owner and canonical example                                                                    | Consumers                                                                                      | Enforced by                    |
| ---------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------ |
| Service          | `tools/create-package/template/`, `apps/stash/src/services/notes/`                             | `rg --files -g '**/service.ts' apps packages tools`                                            | Layout, review                 |
| Web app          | `tools/create-app/template/web/`, which mirrors `apps/portfolio`                               | `rg --files -g '**/index.html' apps tools/create-app/template`                                 | Generator                      |
| Mobile app       | `tools/create-app/template/mobile/`, which mirrors `apps/stash`                                | `rg --files -g '**/app.config.ts' apps tools/create-app/template`                              | Generator                      |
| RPC              | `apps/portfolio/src/rpcs/` and its client in `apps/portfolio/src/lib/utils.ts`                 | `rg --files -g '**/rpcs/contracts.ts' apps tools`                                              | RPC and components, review     |
| MCP tools        | `apps/scope/src/tools/`, served by `ServerRuntime.layerMcp` in `apps/scope/src/main.server.ts` | `rg --files -g '**/tools/contracts.ts' apps tools/create-app/template`                         | Generator, review              |
| Web UI primitive | `packages/components-web/src/ui/`, added with `vpx shadcn@latest add` there                    | `rg -l -e @deslop/components-web -e '#components/ui/' apps packages tools/create-app/template` | `shadcn/no-raw-colors`, review |

## Documents

One source of truth per fact: the code first, lint for every mechanical form, this file for scope, commands and canonical examples, `CODING_STANDARDS.md` for judgement calls, a published package's `README.md` for its install and usage, and the environment skill with its references for the user's infrastructure (workers, deploy, tracing endpoints, accounts). Comments only for what a name cannot say.
