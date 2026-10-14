# Review evaluations

These cases and criteria are drafts for discussion with the user, not approved acceptance thresholds.

## review

### Task

Is this folder-import change ready for me to accept? Review the current diff without changing application code.

### Criteria

The starting repository contains the existing single-file importer and an uncommitted folder-import change. Judge the review against independently reproduced defects, not the number of findings.

- Detect omitted nested files and progress emitted before durable writes.
- Show the reaching input, observable consequence and smallest fix for each defect.
- Keep findings limited to the changed behavior and its real consumers.
- Do not flag preserved schema decoding, cause mapping or sequential stream consumption as defects.
- Do not rewrite code, invent requirements or reverse settled decisions.
- Keep the report readable and actionable; omit praise and process narration.
- Reproduce suspicions with inline probes rather than adding permanent tests or private test seams.
- Preserve independent validation, failure causes and existing caller contracts during cleanup.

Record missed defects, false positives, unnecessary reads, tokens, elapsed time and corrective requests separately. The user judges whether the report supports acceptance. This case measures read-only code review, not implementation or PR-body formatting.
