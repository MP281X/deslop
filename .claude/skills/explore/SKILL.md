---
name: explore
description: Read-only research into code, dependencies, documentation and earlier threads. Use for a plain question, a comparison of approaches, the research before an implementation, or a delegated research brief; machine questions and shared media use environment, reviews and audits use review.
---

# Explore

Answer from code, logs, named threads or primary documentation, and look for the counterexample that decides the question. Name the decision and the observation that settles it before broad exploration. Reuse known sources and capability selections while their inputs remain current; search again only for a missing fact, changed version or contradiction. Read a named reference's feature in its source, not in its README, and dependencies per [Source checkouts](#source-checkouts); use environment's media procedure for videos and posts. Settle a behavior question with a probe per testing's Throwaway. When you count, define and list the members. A failed search or fetch is not a finding. Stop when the evidence answers the question, and reply with the answer first, then only the deciding evidence.

## Source checkouts

Clone before you read a second file of a dependency or reference project, or before you answer a question about its behavior. Read it in a checkout of its official repository at the lockfile version; use a documentation page only for a contract the source does not state. Reuse a matching checkout under `/tmp/repos/` after you check its remote and commit. Never install, build or change a shared checkout.

```bash
git clone --depth 1 --branch <version-tag-or-required-branch> <official-repository-url> "/tmp/repos/<repository>-<version>"
```

## T3 history

Search earlier decisions with `t3_thread_search` before you read transcripts. Each worker stores only its own threads, so an analysis of the user's threads queries both workers: the local one that `hostname -s` names, and the other one through `ssh mp281x@<worker> '<command>'`. Query `~/.t3/userdata/statev2.sqlite` with `sqlite3 -readonly`, and select only the fields you need, never raw payloads or credentials. Current records are in `orchestration_v2_projection_*`; other `projection_*` tables can be stale, except `projection_projects`. Native transcripts are in `~/.claude/projects` and `~/.codex/sessions`. Analyze the full run, including children, tool results, corrections and artifacts; distinguish measured facts from evaluator judgments.
