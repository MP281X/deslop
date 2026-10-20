---
name: explore
description: 'Use before choosing how to build something, before researching an API, library, approach, reference repository or earlier agent session, before a screen, and before proving or judging behavior or a screen.'
---

# Explore

Find the shape the repository already uses, fill gaps from excellent Effect 4 codebases, ground every claim in something you read or ran, and loop on [Evaluate](#evaluate) and review's Code checks (scope, shape, claims) until every question the change touches answers yes (screen questions only for a changed screen).

## Sources, in order

1. **The repository's own style.** The canonical examples its `AGENTS.md` names, then its `CODING_STANDARDS.md`. In a repository being cleaned up, an unnamed nearest file is code to replace.
2. **References** for a shape the repository has no canonical example of: `git clone --depth 1 <url> /tmp/repos/<name>`, or `git -C /tmp/repos/<name> pull` when present, and read the listed paths at the default branch. Copy the structure into the repository's style; take every Effect name from the installed `effect` package's source, since the references run other Effect 4 versions.

| Shape                                       | Repository                                     | Open                                                                                                    |
| ------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Any Effect API, idiomatic usage             | https://github.com/Effect-TS/effect            | `ai-docs/src/`, `packages/effect/src/<Module>.ts`, `packages/effect/*.md`, `migration/`                 |
| Services, layers, errors, schema            | https://github.com/kitlangton/effect-solutions | `packages/website/docs/`                                                                                |
| Services in a large server, tests           | https://github.com/pingdotgg/t3code            | `docs/internals/effect-services.md`, `apps/server/src/`                                                 |
| Contracts shared by server and clients, RPC | https://github.com/pingdotgg/t3code            | `packages/contracts/src/`, `packages/client-runtime/src/rpc/`                                           |
| Architecture and package boundaries         | https://github.com/anomalyco/opencode          | `AGENTS.md`, `packages/core/src/`, `packages/protocol/src/`, `packages/server/src/handlers/`            |
| Plugin SDK, MCP host, local and cloud hosts | https://github.com/UsefulSoftwareCo/executor   | `packages/core/`, `packages/hosts/`, `apps/local/src/`, `apps/cloud/src/`                               |
| MCP server                                  | https://github.com/pingdotgg/t3code            | `apps/server/src/mcp/`                                                                                  |
| CLI, child processes, cluster               | https://github.com/tim-smart/lalph             | `src/commands/`, `src/`                                                                                 |
| Atoms, AtomRpc, React hooks                 | https://github.com/Effect-TS/effect            | `packages/effect/src/reactivity/`, `packages/atom/react/`                                               |
| Atoms in an app                             | https://github.com/tim-smart/bunnings-lite     | `src/atoms/`, `src/RpcClient.ts`                                                                        |
| Expo                                        | https://github.com/pingdotgg/t3code            | `apps/mobile/src/state/`, `docs/internals/mobile-development.md`                                        |
| Web UI, UX and speed                        | https://github.com/pingdotgg/t3code            | `docs/internals/web-ui.md`, `docs/internals/performance-regressions.md`, `apps/web/src/components/ui/`  |
| Components as shipped                       | https://github.com/shadcn-ui/ui                | `apps/v4/registry/`, `skills/`                                                                          |
| Design system document                      | https://github.com/google-labs-code/design.md  | `docs/spec.md`; worked: executor `design.md`, Effect-TS/website `apps/web/DESIGN.md`                    |
| Official Effect apps                        | https://github.com/Effect-TS/website           | `apps/web/`; also Effect-TS/discord-bot and Effect-TS/cafe                                              |
| Agent loop, tools, skills, permissions      | https://github.com/anomalyco/opencode          | `packages/core/src/session/`, `packages/core/src/tool/`, `packages/core/src/skill/`, `packages/ai/src/` |
| Skills, prompts, `AGENTS.md`                | https://github.com/mattpocock/skills           | `skills/productivity/writing-for-agents/`, `skills/engineering/`                                        |
| Skills that augment a strong model          | https://github.com/cursor/plugins              | `pstack/skills/`                                                                                        |
| Skill packaging and evaluation              | https://github.com/anthropics/skills           | `skills/skill-creator/`                                                                                 |
| Effect knowledge for agents                 | https://github.com/Effect-TS/skills            | `skills/effect-ts/`                                                                                     |

**Screens.** When a Mobbin tool is available, search its screens or flows for the screen's job and build from the relevant hits; otherwise from the repository's own screens and the references above. Color, radius, type, spacing and shadow live in the theme the repository's `components.json` names.

## Ground

**Grounded claims.** A name, signature, behavior, limit, price or spec comes from an artifact read or run in this session: the source at the installed version, a probe's output, a real request or a trace. Name it beside the claim; with none, write "unverified" instead of the claim.

```bash
rg -on '^export (const|function) (decodeUnknown\w*|fromJsonString|parseJson)\b' /tmp/repos/effect/packages/effect/src/Schema.ts
# → decodeUnknownEffect decodeUnknownExit decodeUnknownOption … fromJsonString   (Effect 3's decodeUnknown and parseJson are gone)
```

**Probe.** One question, one inline script against the public interface or real data through the repository's runner, such as `vp node -e '<script>'`. Shrink a reproduction until every input is needed; after two failed fixes, test the premise they share.

## Evaluate

| Question                                                                       | Instrument                                                                                                          |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Does the code read in place, top to bottom?                                    | One pass over the diff: each jump elsewhere to understand a line, and each comment a name could carry, is a finding |
| Did every changed behavior and consumer run through its interface?             | The final code in the browser, by request, from the CLI or in the simulator; a green suite is not this              |
| Does every element fit its container and share its neighbors' edges?           | The browser's element boxes at 390 px and desktop, light and dark, with long text, 0, 1 and many records            |
| Does the screen read like its reference?                                       | Captures side by side with the same data; blur them: content and the next action still lead                         |
| Does every input answer at once, with no flicker?                              | Event timing, long frames and layout shift after the real input; the action's trace before and after                |
| Is every state reachable and shown?                                            | Empty, loading, partial, error, success and long content, each captured                                             |
| Is every part needed?                                                          | Delete it and rerun the proof; a dependency, Effect or the repository may already do it                             |
| Does each test fail when the behavior breaks and pass when the internals move? | Break the behavior, then restructure the code; tests cover owned logic, never UI or libraries                       |

**Tells** a screen fails on: a gradient or glow, a colored side stripe, a bordered card per section, equal prominence everywhere, a color per tile, generic copy, content waiting on an entrance animation, the hero, feature grid and logo row skeleton.
