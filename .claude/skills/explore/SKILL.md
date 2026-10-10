---
name: explore
description: Read-only research into code, dependencies, documentation and earlier threads. Use for a plain question, a comparison of approaches, the research before an implementation, or a delegated research brief; machine questions and shared media use environment, audits and critiques use review.
---

# Explore

Answer the question from code, logs, named threads or primary documentation, and find the counterexample that would decide it. Read a named reference's feature in its source, not only its README. Read dependencies through [Source checkouts](#source-checkouts), never in `node_modules`, and videos and posts through environment's [media reference](../environment/references/media.md). When you count something, define and list the members. A failed search or fetch is not a finding. Stop when the evidence answers the question.

Reply in at most 40 lines, the answer first, then only the evidence that decides it, as a table or one-line bullets. Group related findings rather than drop any, and never move results into `<details>` or a file.

## Children

A primary gives each independent area to its own research child, in parallel and in the background. Research children run GPT-6.1 Sol at medium effort, or at high effort for a fact traced across packages or sources, on the Standard service tier. A child follows only this skill, works read-only and never delegates.

## Source checkouts

Read a dependency in a checkout of its official repository at the version the lockfile uses. Reuse a matching checkout under `/tmp/repos/` after you check its remote and commit. Never install, build or change a shared checkout.

```bash
git clone --depth 1 --branch <version-tag-or-required-branch> <official-repository-url> "/tmp/repos/<repository>-<version>"
```

## T3 history

Search earlier decisions with `t3_thread_search` before you read transcripts. Each worker stores only its own threads, so an analysis of the user's threads queries every worker, the other one through `ssh mp281x@<worker> '<command>'`. Query `~/.t3/userdata/statev2.sqlite` with `sqlite3 -readonly`, select only the fields you need, and never read raw payloads or credentials. Current records live in `orchestration_v2_projection_*`; other `projection_*` tables can be stale. Native transcripts live in each worker's `~/.claude/projects` and `~/.codex/sessions`, and a whole-thread analysis follows the retrospective skill in the deslop repository.
