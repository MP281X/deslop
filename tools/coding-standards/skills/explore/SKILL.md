---
name: explore
description: Use before reading anything beyond the files you will edit, their consumers and the canonical example, for a question that needs no change, a comparison of approaches, dependencies or reference repositories, research before a change, a delegated research brief, and a question about earlier agent sessions.
---

# Explore

- **Decision first.** Name the decision and the observation that settles it; stop when the evidence settles it. Look for the counterexample, not more support.
- **Existing first.** Lead with what the codebase and its dependencies already do for the same job. Before any hand-written type, table, guard, wrapper, store or protocol, list the owning module's exports in its source checkout and read the closest ones, then how its own tests and examples use them; a helper found this way replaces the code:

  ```bash
  rg -on '^export (const|function|class|interface) \w*(Literal|Tagged|Union)\w*' /tmp/repos/effect-4.0.5/packages/effect/src/Schema.ts
  # → Literal Literals TaggedStruct TaggedUnion Union toTaggedUnion …
  # read each: Literals has pick and transform; TaggedUnion has cases, guards and match
  ```

- **Sources.** Raw material over summaries: code, logs, rows and traces over docs and memory, a probe over reading; settle behavior with an inline script per engineering's Proof. Reproduce a stated belief from raw data before you build on it. Search by the domain concept, not only the request's words. A failed search is not a finding. When you count, define and list the members.
- **Sessions.** Earlier agent sessions are raw material too: read the full run with its children and the user's corrections, from wherever the environment stores them.
- **Answer** first, then only the deciding evidence with paths and lines; mark measured facts apart from inference.

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
