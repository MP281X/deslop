---
name: explore
description: Use before reading anything beyond the files you will edit, their consumers and the canonical example, for a question that needs no change, a comparison of approaches, dependencies or reference repositories, research before a change, a delegated research brief, and a question about earlier agent sessions.
---

# Explore

- **Decision first.** Name the decision and the observation that settles it; stop when the evidence settles it. Look for the counterexample, not more support.
- **Existing first.** Lead with what the codebase and its dependencies already do for the same job. Before any hand-written type, table, guard, wrapper, store or protocol, list the owning module's exports in its source checkout and read the closest ones, then how the owning skill's Study repositories use them; a helper found this way replaces the code:

  ```bash
  rg -on '^export (const|function|class|interface) \w*(Literal|Tagged|Union)\w*' /tmp/repos/effect-4.0.5/packages/effect/src/Schema.ts
  # → Literal Literals TaggedStruct TaggedUnion Union toTaggedUnion …
  # read each: Literals has pick and transform; TaggedUnion has cases, guards and match
  ```

- **Sources.** Raw material over summaries: code, logs, rows and traces over docs and memory, a probe over reading; settle behavior with an inline script per engineering's Proof. Reproduce a stated belief from raw data before you build on it. Search by the domain concept, not only the request's words. A failed search is not a finding. When you count, define and list the members.
- **Sessions.** Earlier agent sessions are raw material too: read the full run with its children and the user's corrections, from wherever the environment stores them.
- **Answer** first, then only the deciding evidence with paths and lines; mark measured facts apart from inference.

## Source checkouts

Read a dependency in a checkout of its official repository at the version the lockfile holds, never in `node_modules`. Reuse a matching checkout under `/tmp/repos/` after checking its remote and commit; never build or change a shared one.

| Dependency                                                                 | Repository                                 | Tag                                            |
| -------------------------------------------------------------------------- | ------------------------------------------ | ---------------------------------------------- |
| Effect and `@effect/*`: platform, vitest, atom-react, sql, ai, `packages/` | https://github.com/Effect-TS/effect        | `effect@<version>`, `@effect/<name>@<version>` |
| Vite+: `vp`, Vite, Vitest, packing                                         | https://github.com/voidzero-dev/vite-plus  | `v<version>`                                   |
| TanStack Router and Start                                                  | https://github.com/TanStack/router         | `@tanstack/<package>@<version>`                |
| Expo and `@expo/ui`                                                        | https://github.com/expo/expo               | `expo@<version>`, `@expo/ui@<version>`         |
| Better Auth                                                                | https://github.com/better-auth/better-auth | `v<version>`                                   |

```bash
git clone --depth 1 --branch effect@4.0.5 https://github.com/Effect-TS/effect /tmp/repos/effect-4.0.5
```

## Study repositories

For a shape the repository has no canonical example for, read how strong engineers built it before you invent one: engineering, design and delivery each keep a Study table for their domain, and this one covers agent instructions. Clone at the default branch with `git clone --depth 1` into `/tmp/repos/<name>`, read the named paths first, and copy the idea, not the files:

| Study                                                                 | Repository and directories                                                                                                                                 |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Skills: terse engineering workflows, writing for agents               | [Matt Pocock's skills](https://github.com/mattpocock/skills): `skills/engineering`, `skills/productivity/writing-for-agents`                               |
| Skills: one router skill, principles and playbooks                    | [pstack by poteto](https://github.com/cursor/plugins): `pstack/skills/poteto-mode` (`playbooks/authoring-a-skill.md`), `pstack/skills/principle-*`         |
| Skills: explanatory figures as objects, references checked by scripts | [Anatomy](https://github.com/wheresryan22/anatomy): `SKILL.md`, `references/craft.md`, `examples`                                                          |
| Skills tested like code: pressure tests, verification, subagents      | [Superpowers](https://github.com/obra/superpowers): `skills/writing-skills`, `skills/verification-before-completion`, `skills/subagent-driven-development` |
| Skill format, creation and evaluation                                 | [Anthropic skills](https://github.com/anthropics/skills): `skills/skill-creator`, `skills/frontend-design`, `skills/mcp-builder`                           |
