## Package decisions

- This repository owns the complete reusable workflow snapshot: global conduct, primary configuration, specialist roles, and shared skills. Repository-specific policy remains in the root `AGENTS.md` and `.agents/skills/project-engineering`; do not install it as reusable policy.
- `assets/AGENTS.md` is the global conduct policy installed as `~/.codex/AGENTS.md`. This file contains package-maintainer decisions only; do not move them into the installed global policy.
- `assets/codex` owns the primary configuration and specialist roles. Primary owns user intent, scope, material decisions, and initial responsibility assignment; specialists own their bounded responsibilities, direct collaboration, and terminal results.
- `assets/skills` owns reusable workflow and engineering guidance. Keep project-specific engineering decisions in the repository skill.
- `src/main.ts` owns the CLI boundary and replaces every package-owned installed path from the current snapshot. Replacement prevents deleted or renamed policy from surviving; do not merge, back up, or restore owned paths. Preserve unrelated Codex data and configuration.
