---
name: explore
description: Read-only research into code, dependencies, documentation and earlier threads. Use for a plain question, a comparison of approaches, the research before an implementation, or a delegated research brief; machine questions and shared media use environment, reviews and audits use software-factory.
---

# Explore

Answer from code, logs, named threads or primary documentation, and look for the counterexample that decides the question. Read a named reference's feature in its source, not in its README. Read dependencies per [Source checkouts](#source-checkouts), never in `node_modules`, and videos and posts per environment's [media reference](../environment/references/media.md). When you count, define and list the members. A failed search or fetch is not a finding. Stop when the evidence answers the question.

Reply with the answer first, then only the deciding evidence, as a table or one-line bullets.

## Source checkouts

Read a dependency in a checkout of its official repository at the lockfile version. Reuse a matching checkout under `/tmp/repos/` after you check its remote and commit. Never install, build or change a shared checkout.

```bash
git clone --depth 1 --branch <version-tag-or-required-branch> <official-repository-url> "/tmp/repos/<repository>-<version>"
```

## Council

For an open question, start six children at once on the council models the pair prompt's Children rule names, three per lab, so both labs give points of view. Write one context file with the question verbatim and the measured facts; each brief holds its path and one distinct point of view, such as a skeptic who deletes half, a cost engineer, an evals researcher, a tools builder, a designer with taste, or the user as his messages show him. Then cluster the ideas, test the strongest against the evidence, and decide yourself; children never decide.

A council member returns divergent ideas from its point of view only, in at most 30 lines: each idea's name, mechanism, why it beats the current state with a measured number where one exists, and the smallest experiment that proves it right or wrong. It ends with the idea the other points of view will miss and one current practice to stop.

## T3 history

Search earlier decisions with `t3_thread_search` before you read transcripts. Each worker stores only its own threads, so an analysis of the user's threads queries both workers, the other one through `ssh mp281x@<worker> '<command>'`. Query `~/.t3/userdata/statev2.sqlite` with `sqlite3 -readonly`, and select only the fields you need, never raw payloads or credentials. Current records are in `orchestration_v2_projection_*`; other `projection_*` tables can be stale, except `projection_projects`. Native transcripts are in `~/.claude/projects` and `~/.codex/sessions`. A whole-thread analysis follows the retrospective skill in the deslop repository.
