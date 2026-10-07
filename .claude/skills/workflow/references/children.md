# Child procedures

Return complete findings in one pass; the primary allows at most two rounds.

## Research

Answer the question from code, logs, named threads or primary documentation, and look for the counterexample that would decide it. Read dependencies in a source checkout, never in `node_modules`. Read videos and posts through environment's media reference. When you count something, define and list the members. Stop when you have answered the question.

### Source checkouts

Read a dependency in a checkout of its official repository at the version the lockfile uses. Reuse a matching checkout under `/tmp/repos/` after you check its remote and commit; shared checkouts are read-only and need no install or build.

```bash
git clone --depth 1 --branch <version-tag-or-required-branch> <official-repository-url> "/tmp/repos/<repository>-<version>"
```

### T3 history

Prefer T3's thread tools, and search earlier decisions with `t3_thread_search` before you read transcripts. `t3_thread_search` and the database cover only the worker that runs you, so an analysis of the user's threads covers every worker: run the same queries on the other one with `ssh mp281x@<worker> '<command>'`. The Mac has no agent threads. For read-only inspection, set `T3_DB` to `~/.t3/userdata/statev2.sqlite`; session files sit in each worker's `~/.claude/projects` and `~/.codex/sessions`. Query it with `sqlite3 -readonly`, and select only the fields you need; never read raw payloads or credentials. Live threads, runs, subagents and turn items are in `orchestration_v2_projection_*`. Legacy `projection_*` tables and `provider_session_runtime` can be stale.

To recover a thread's native transcripts, find its provider sessions, then the session files:

```bash
sqlite3 -readonly -header -column "$T3_DB" "SELECT provider_thread_id, provider, status, json_extract(payload_json, '$.nativeThreadRef.nativeId') AS session_id, updated_at FROM orchestration_v2_projection_provider_threads WHERE thread_id = '<thread id>' ORDER BY updated_at DESC;"
S='<selected session id>'; : "${S:?No session selected}"
find "$HOME/.codex/sessions" "$HOME/.claude/projects" -type f -name "*$S.jsonl"
```

- **Session choice.** Pick the session that covers the run in question; the latest one can miss stopped or replaced runs.
- **Subagents.** Claude subagents sit in `<session>/subagents/`. A Codex child's first `session_meta` record names its parent in `payload.parent_thread_id`. Messages forked from the parent are not new work.
- **Compaction.** A `compacted` record marks a compaction, not a task boundary.

Return the answer, the sources that decide it and the facts still open.

## Code review

Work as an adversary: assume the work is wrong and prove where. Settle each suspicion yourself with an inline probe or a focused existing test. Do not report a mere possibility or ask the primary to try it. The same stance applies to the cleanup audit and the body reader.

- **Depth.** Read every hand-written changed line. For generated output, review the generator change and a representative subset, such as one package per source format. Trace each contract through its real consumers, failure paths, concurrency and resource ownership against the merge base. Try the inputs, orderings and failures that the author's tests miss.
- **Findings.** Report broken behavior or contracts that input from a real caller can reach. Report violations of engineering, design or `CODING_STANDARDS.md` rules only in lines the reviewed change adds or alters, and only where lint does not already enforce them. Never propose restyling code the change does not otherwise need.
- **Not findings.** Taste without a rule is not a finding. Code that handles input which engineering and lint never allow is a cleanup finding, not a defect.
- **Value.** Report only what a user, caller or maintainer would notice. Leave out wording preferences, hypothetical inputs, restatements and changes the branch did not make.
- **Second round.** Review only the fixes since the reviewed commit and their consumers. The brief lists every earlier finding, confirmed or rejected.
- **Probes.** Run inline scripts with the repository's runtime through Vite+: `vp node -e '<script>'`, or `vp env exec bun -e '<script>'` in Bun repositories such as Dual. Node cannot strip types under `node_modules`, so integrated TypeScript runs through the app or test entrypoint.

Return the findings ranked by consequence, or "Clean" with the scope you covered. Each finding gives the path and line, the reaching input, and the actual and required outcome. It also gives the consequence, the probe that showed it and the smallest fix.

## Cleanup audit

Classify every changed file and hunk in your area against the plan's intent, and default to removal:

- **Revert:** churn such as formatting, lint-only rewrites, renames, reordered keys and unrelated files. Propose the default branch's code, with a lint downgrade or a reasoned disable where new rules would fail it.
- **Supersede:** features and versions that the final direction replaced, compatibility for versions nobody released, and capabilities that only a test or demo needed.
- **Simplify:** dead code, unused exports, duplicate logic, layered overrides, no-ops, workarounds and machinery that a smaller design avoids.
- **Keep:** what the intent needs, with the reason.

Read every hand-written hunk; a sample is not an audit. Judge generated output through its generator and a representative subset. Return one row per item with the path and lines, class, evidence, smallest change, size and what the change breaks.

## Critique

Challenge the outcome, the taste and the attempts so far, and do not defer to the author. Compare different mechanisms, including a smaller one. Test the strongest counterexample and the weakest assumption. Prefer a reversible combination when compatible strengths combine. Return the recommendation, its decisive reason and the observation that would change it.

## Body reader

Read the published pull request as a reviewer who knows nothing else. Download the body and every embedded capture from the host, such as `glab api "projects/<project>/uploads/<secret>/<file>"`, and inspect each one. Compare them with the head of the branch and the source tickets. Report:

- a claim that a capture or the code contradicts, including a capture of UI the head no longer has;
- a ticket requirement without proof;
- a body that opens with anything but the branch's central change, or that describes only the last run;
- a capture whose text is unreadable at the body's width, that shows loading, or that ends before the outcome;
- a body that departs from the [example body](publishing.md#example-body): evidence away from its entry, a video duration, a checklist, a Gaps, Needs you or ticket section, and process words.

Return each finding with the section, the evidence and the smallest fix.
