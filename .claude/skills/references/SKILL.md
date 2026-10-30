---
name: references
description: Load for unfamiliar APIs, architecture without a canonical example, or screen design.
---

# References

The repository's canonical examples (`AGENTS.md`) lead; these fill a gap. Keep reference clones read-only under `/tmp/repos/<name>`, checking their remote and revision before reuse. Resolve API uncertainty from the installed dependency's source: reference versions can differ, especially Effect 3 versus 4.

## Sources

| Shape                                       | Repository                                     | Open                                                                                                        |
| ------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Any Effect API, idiomatic usage             | https://github.com/Effect-TS/effect            | `ai-docs/src/`, `packages/effect/src/<Module>.ts`, `packages/effect/*.md`, `migration/`                     |
| Services, layers, errors, schema            | https://github.com/kitlangton/effect-solutions | `packages/website/docs/`                                                                                    |
| Services in a large server, tests           | https://github.com/pingdotgg/t3code            | `docs/internals/effect-services.md`, `apps/server/src/`                                                     |
| Contracts shared by server and clients, RPC | https://github.com/pingdotgg/t3code            | `packages/contracts/src/`, `packages/client-runtime/src/rpc/`                                               |
| Architecture and package boundaries         | https://github.com/anomalyco/opencode          | `AGENTS.md`, `packages/core/src/`, `packages/protocol/src/`, `packages/server/src/handlers/`                |
| Plugin SDK, MCP host, local and cloud hosts | https://github.com/UsefulSoftwareCo/executor   | `packages/core/`, `packages/hosts/`, `apps/local/src/`, `apps/cloud/src/`                                   |
| MCP server                                  | https://github.com/pingdotgg/t3code            | `apps/server/src/mcp/`                                                                                      |
| CLI, child processes, cluster               | https://github.com/tim-smart/lalph             | `src/commands/`, `src/`                                                                                     |
| Atoms, AtomRpc, React hooks                 | https://github.com/Effect-TS/effect            | `packages/effect/src/reactivity/`, `packages/atom/react/`                                                   |
| Atoms in an app                             | https://github.com/tim-smart/bunnings-lite     | `src/atoms/`, `src/RpcClient.ts`                                                                            |
| State machines, statecharts                 | https://github.com/typeonce-dev/effect-machine | `packages/effect-machine/docs/`, `packages/effect-machine-react/README.md`, `packages/effect-machine/test/` |
| Expo                                        | https://github.com/pingdotgg/t3code            | `apps/mobile/src/state/`, `docs/internals/mobile-development.md`                                            |
| Web input, loading, cache and navigation    | https://github.com/pingdotgg/t3code            | `docs/internals/web-ui.md`, `docs/internals/performance-regressions.md`, `apps/web/src/components/ui/`      |
| Components as shipped                       | https://github.com/shadcn-ui/ui                | `apps/v4/registry/`, `skills/`                                                                              |
| Design system document                      | https://github.com/google-labs-code/design.md  | `docs/spec.md`; worked: executor `design.md`, Effect-TS/website `apps/web/DESIGN.md`                        |
| Official Effect apps                        | https://github.com/Effect-TS/website           | `apps/web/`; also Effect-TS/discord-bot and Effect-TS/cafe                                                  |
| Agent loop, tools, skills, permissions      | https://github.com/anomalyco/opencode          | `packages/core/src/session/`, `packages/core/src/tool/`, `packages/core/src/skill/`, `packages/ai/src/`     |
| Skills, prompts, `AGENTS.md`                | https://github.com/mattpocock/skills           | `skills/productivity/writing-for-agents/`, `skills/engineering/`                                            |
| Skills that augment a strong model          | https://github.com/cursor/plugins              | `pstack/skills/`                                                                                            |
| Skill packaging and evaluation              | https://github.com/anthropics/skills           | `skills/skill-creator/`                                                                                     |
| Effect knowledge for agents                 | https://github.com/Effect-TS/skills            | `skills/effect-ts/`                                                                                         |

**Screens.** Start from the screen's job and its fewest concepts. Search Mobbin's screens or flows for that job, beside the repository's own screens and the references above, and borrow an interaction only when it removes a concept, an action or an ambiguity, never because it is the standard. Color, radius, type, spacing and shadow live in the theme the repository's `components.json` names.

**Evidence.** Ground consequential claims in the deciding source, trace or probe; name what remains unverified.

**Visual taste.** For this user's screens, avoid gradients or glows, colored side stripes, a bordered card per section, equal prominence everywhere, a color per tile, generic copy, content waiting on an entrance animation and the hero/feature-grid/logo-row skeleton. The user's picked reference wins.
