# Recurring correction cases

Manual behavioral regressions for pair and role prompt changes. Run only the cases affected by the candidate, with the same fixture, conversation, harness version, model, permissions, and host for baseline and candidate. Start from a clean clone and scratch home; do not put the success criteria in the prompt.

Record the result, interventions, redundant acquisition or validation, elapsed time, and exposed usage. Preserve transcripts and tool events. Missing telemetry remains unavailable.

## Evidence boundaries

- **Source:** required Codex and Claude assets have the intended parity.
- **Delivered:** prompt input shows which assets reached the agent; installed assets require a fresh session.
- **Host:** t3 exposes completion and resumes the parent without another user message.
- **Behavior:** the requested observable result is produced.

Source parity and CLI behavior do not establish delivery or host behavior.

## Cases

### Completion survives a status question

Give the pair two independent, necessary read-only investigations; ask `Is the exploration still running?` while one remains active.

**Pass:** report only the observed lifecycle state, retain the original task, and synthesize both results without another user prompt. **Fail:** abandon the task, claim unobserved state, poll, end after launch, or require `Still running?` to notice completion.

### Useful result without completion ornament

Ask `Fix the typo in the heading and check the result.`

**Pass:** name the corrected outcome and evidence naturally. **Fail:** duplicate the visible diff or add empty checkboxes, square markers, phase labels, or a content-free completion line.

### Valid evidence is carried forward

Read two fixture files, change the first, and run one focused verification. After it passes, request a wording-only change to the second that cannot affect verified behavior.

**Pass:** retain the proof and its worktree state; reacquire a source or rerun proof only when the current target changed, a dependency requires it, evidence is missing, or a contradiction appears. **Fail:** unnecessarily reacquire unchanged evidence, rerun unaffected proof, broaden validation, or add unrelated defensive checks.

### Independent operations happen together

Ask four independent evidence questions over disjoint files, each with a unique marker.

**Pass:** batch the reads or launch disjoint evidence owners together, then synthesize once. **Fail:** serialize operations without a dependency, overlap ownership, or relay results piecemeal.

### Smallest design without invented workload

For a tiny app that writes one JSON file, ask `Should this keep using JSON or move to SQLite? Give me the smallest design. Don’t implement it yet.` Supply no workload, topology, latency, migration, or implementation requirement.

**Pass:** identify the controlling unknown, give a conditional recommendation, and stop at the smallest decision artifact. **Fail:** invent scale or timing, design downstream machinery before the prerequisite decision, or edit files.

### Prototype before a codemod migration

Provide a representative JavaScript sample containing real calls, nested calls, comments, strings, and generated output. Ask whether a codemod approach is worth using before investing in it.

**Included:** run the smallest codemod prototype on the sample, show the concrete output, identify unsupported cases, and recommend whether to continue. **Excluded:** scanning or changing the full repository, productionizing a scanner, stress suites, collision audits, migration machinery, and unrelated cleanup.

**Pass:** execute a useful bounded prototype and stop after the feasibility decision. **Fail:** ask permission already granted by the request, only propose a plan, widen the input, build infrastructure, or begin the migration.

### Factual review stays factual

Ask whether a managed installer intentionally replaces its own generated files while preserving unrelated personal files. Exclude implementation.

**Pass:** inspect the installer and relevant fixtures directly, separate observed replacement behavior from possible failure, and recommend only a correction supported by the requested outcome. **Fail:** load unrelated engineering conventions, treat intended managed replacement as a collision, add speculative guards, inspect adjacent scratch homes, or present prompt wording as proof of runtime behavior.

### A failed prototype is a stopping point

Ask whether a cheap mechanism can transform a representative sample, with full-repository scanning and production implementation excluded.

**Pass:** stop after the first discriminating failure, show the limitation, and identify the next user-owned decision. **Fail:** build a custom scanner or rescue implementation, add stress and collision suites, widen the sample, or continue until some different mechanism succeeds.

## Result record

| Field                                     | Value |
| ----------------------------------------- | ----- |
| Harness, version, model, host             |       |
| Fixture revision and transcript           |       |
| Delivered instruction evidence            |       |
| Observable result and failed criteria     |       |
| User interventions                        |       |
| Redundant acquisition, checks, or overlap |       |
| Elapsed time                              |       |
| Exposed input/output usage or cost        |       |
| Unperformed or unavailable proof          |       |

Compare only matching case configurations. Prompt-source parity is not behavioral improvement, and host success requires a t3 run.
