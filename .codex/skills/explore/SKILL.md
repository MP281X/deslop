---
name: explore
description: Use for research and exploration, in a delegated research brief or before reading beyond the files you will edit, their consumers and the canonical example: a question that needs no change, a comparison of approaches, a dependency's API or behavior, reference repositories, earlier agent sessions.
---

# Explore

Research that settles a decision; engineering owns how the code is then written.

- **Decision first.** Name the decision and the observation that settles it; stop when the evidence settles it.
- **Falsification.** Look for the counterexample, not more support. A failed search is not a finding; when you count, define and list the members.
- **Primary sources.** Code, logs, rows and traces over docs and memory; a probe over reading, run per engineering's Spike. Reproduce a stated belief from raw data before you build on it. Search by the domain concept, not only the request's words.
- **Existing first.** What the codebase and its dependencies already do for the job: list the owning module's exports in its source checkout, read the closest ones, then their tests and examples.

  ```bash
  rg -on '^export (const|function|class|interface) \w*(Literal|Tagged|Union)\w*' /tmp/repos/effect-4.0.5/packages/effect/src/Schema.ts
  # → Literal Literals TaggedStruct TaggedUnion Union toTaggedUnion …
  ```

- **Sessions.** Earlier agent sessions are raw data: the full run, its children and the user's corrections.
- **Inverted pyramid.** Answer first, then only the deciding evidence with paths and lines; measured facts apart from inference.

## Repositories

Clone under `/tmp/repos/` with `--depth 1`; reuse a matching checkout after checking its remote and commit, never build or change a shared one.

```bash
git clone --depth 1 --branch effect@4.0.5 https://github.com/Effect-TS/effect /tmp/repos/effect-4.0.5
```

**Documentation.** A library's source, tests and examples are its documentation: read them at the version the lockfile holds, never in `node_modules`, before you use an API.

- https://github.com/Effect-TS/effect
- https://github.com/voidzero-dev/vite-plus
- https://github.com/TanStack/router
- https://github.com/shadcn-ui/ui
- https://github.com/emilkowalski/sonner
- https://github.com/motiondivision/motion
- https://github.com/vercel/ai
- https://github.com/electric-sql/electric
- https://github.com/better-auth/better-auth
- https://github.com/expo/expo
- https://github.com/heygen-com/hyperframes

**References.** Good code, design and architecture: read them at the default branch for patterns, examples and options to brainstorm, when the repository has no canonical example.

- https://github.com/pingdotgg/t3code
- https://github.com/UsefulSoftwareCo/executor
- https://github.com/anomalyco/opencode
- https://github.com/rocicorp/mono
- https://github.com/bluesky-social/social-app
- https://github.com/mattpocock/skills
- https://github.com/obra/superpowers
- https://github.com/anthropics/skills
