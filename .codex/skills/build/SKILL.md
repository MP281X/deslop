---
name: build
description: 'Use before writing or changing code, tests, scripts, configuration or a screen; before researching an API, library, approach or earlier agent session; before a repository fix, check, lint or test command; and before proving or judging behavior or a screen.'
---

# Build

Copy what excellent Effect 4 codebases already do, ground every claim in something you read or ran, and loop on [Evaluate](#evaluate) until every question the change touches answers yes (screen questions only for a changed screen); review asks the same questions. The repository's `AGENTS.md` wins over this skill, and lint owns every mechanical form.

## References

Before an unfamiliar shape, open its reference: `git clone --depth 1 <url> /tmp/repos/<name>`, or `git -C /tmp/repos/<name> pull` when present, and read the listed paths at the default branch. Copy the structure; take every Effect name from the installed `effect` package's source, since the references run other Effect 4 versions. In a repository being cleaned up, the nearest file is code to replace; its canonical examples are the ones `AGENTS.md` names.

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

**Screens.** When a Mobbin tool is available, search its screens or flows for the screen's job and build from the relevant hits; otherwise from the references above and the repository's own screens. Color, radius, type, spacing and shadow live in the theme the repository's `components.json` names.

## Ground

**Grounded claims.** A name, signature, behavior, limit, price or spec comes from an artifact read or run in this session: the source at the installed version, a probe's output, a real request or a trace. Name it beside the claim; with none, write "unverified" instead of the claim.

```bash
rg -on '^export (const|function) (decodeUnknown\w*|fromJsonString|parseJson)\b' /tmp/repos/effect/packages/effect/src/Schema.ts
# → decodeUnknownEffect decodeUnknownExit decodeUnknownOption … fromJsonString   (Effect 3's decodeUnknown and parseJson are gone)
```

**Probe, don't guess.** One question, one inline script against the public interface or real data through the repository's runner, such as `vp node -e '<script>'`. Shrink a reproduction until every input is needed; after two failed fixes, test the premise they share.

**Verify once.** The repository's static gate and tests, chained bare at the root, after the whole change and after each round of fixes; read failures from that run, the first error in each file first.

```bash
<static gate> && <test>
# not: <gate> 2>&1 | tail -5 && <test>, where test runs after a failed gate
```

## Evaluate

| Question                                                                       | Instrument                                                                                                          |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Is every mechanism one the request needs?                                      | The request verbatim beside each new script, store, wrapper, branch or edge case                                    |
| Does each shape match its reference?                                           | The reference file open beside the diff                                                                             |
| Does the code read in place, top to bottom?                                    | One pass over the diff: each jump elsewhere to understand a line, and each comment a name could carry, is a finding |
| Does every claim name its artifact?                                            | The file and line, command output, request or trace beside it                                                       |
| Did every changed behavior and consumer run through its interface?             | The final code in the browser, by request, from the CLI or in the simulator; a green suite is not this              |
| Does every element fit its container and share its neighbors' edges?           | The browser's element boxes at 390 px and desktop, light and dark, with long text, 0, 1 and many records            |
| Does the screen read like its reference?                                       | Captures side by side with the same data; blur them: content and the next action still lead                         |
| Does every input answer at once, with no flicker?                              | Event timing, long frames and layout shift after the real input; the action's trace before and after                |
| Is every state reachable and shown?                                            | Empty, loading, partial, error, success and long content, each captured                                             |
| Is every part needed?                                                          | Delete it and rerun the proof; a dependency, Effect or the repository may already do it                             |
| Does each test fail when the behavior breaks and pass when the internals move? | Break the behavior, then restructure the code; tests cover owned logic, never UI or libraries                       |

**Tells** a screen fails on: a gradient or glow, a colored side stripe, a bordered card per section, equal prominence everywhere, a color per tile, generic copy, content waiting on an entrance animation, the hero, feature grid and logo row skeleton.

## Write these shapes first

The tempting fix for each trips another rule or reshapes the code; every other diagnostic is fixed in place as its message says.

- **Make illegal states unrepresentable.** `export type Kind = typeof Kind.Type` above `export const Kind = Schema.Literals([...])`, subset `Kind.pick`; a recursive schema hand-writes its type, `readonly` as `Schema.Array` decodes it, and annotates the `suspend` thunk; other shapes mutable, `readonly` only on service properties.
- **Type the boundary.** Decode an `any` or `unknown` with the protocol schema; never `?.`, a cast or a disable on it.
- **One home per type.** The library's type or `ReturnType<typeof make>` in the signature, never a module alias; import from the defining module.
- **Reset by key.** Atoms at module level or in an `Atom.family` keyed by their input, built on the runtime the repository's `AGENTS.md` names; `key` resets state when a prop changes, render derives a value, `useRef` holds lifecycle state, and effects never set state. Components read atoms and never run an Effect; the screen's owner wraps one `Suspense` and one error boundary.

```ts
export const load = Effect.fn('Notes.load')(
	function* (path: string) {
		const fs = yield* FileSystem.FileSystem
		yield* pipe(fs.remove(`${path}.lock`), Effect.ignore({log: 'Warn', message: 'Lock not removed'}))
		return yield* fs.readFileString(path)
	},
	Effect.mapError(cause => NotesError.make({cause, message: 'Cannot read the note'}))
)
export const loadAll = Effect.fn('Notes.loadAll')(function* (paths: string[]) {
	return yield* Effect.forEach(paths, load, {concurrency: 'unbounded'})
})
// not: Effect.catch(() => Effect.void), Effect.orDie, mapError(() => X.make({message})), Effect.provide inside a service
```

```ts
function label(entry: Entry) {
	return Boolean.match(entry.done, {onFalse: () => 'Running', onTrue: () => 'Done'})
}
export function summarize(entries: Entry[]) {
	return {
		labels: pipe(
			entries,
			Array.filter(entry => entry.open),
			Array.map(label)
		),
		total: Array.reduce(entries, 0, (sum, entry) => sum + entry.tokens)
	} satisfies Summary
}
// not: a ? b : c, continue, let total, const open = entries.filter(…), const label = (entry) => …, summarize(): Summary
```

**Same correction twice** becomes impossible at the highest level that works: an owner component or type, then a lint rule whose message names the one fix, with a rejected and an accepted case from the real mistake. A diagnostic on code the rules allow is a rule bug: fix the rule. A disable needs an outside contract named in its `--` reason.
