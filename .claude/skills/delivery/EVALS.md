# delivery evaluations

## writing

### Task

Turn this change into something I can review quickly: the final thread reply, PR title and body, commit message, and the updated agent instruction.

Change facts: folder import is added to an existing single-file importer; progress represents records already written; stopping keeps those records. The CLI and HTTP API still support one file. The instruction currently reads: "Always ask the user through a question card, and if they don't answer after five minutes schedule the recommended default." The user now wants context, question and options together in the thread and no default taken. Write the artifacts under artifacts; do not change product code or settings.

### Criteria

Judge the thread reply, PR title and body, commit message and instruction as separate artifacts.

- State the user-visible change and cancellation contract without inventing guarantees.
- Keep the final reply concise. Add only the whole-worktree picture and a real preview URL when available; omit T3's PR, stack, agent, task and pipeline information.
- Give each artifact its role; do not repeat the same essay across them.
- Remove question cards and scheduled defaults without inventing new permissions.
- Use English, established technical terms and the existing publishing format.

List every edit you require before accepting each artifact; the user makes the final choice. A later instruction-behavior comparison must supply a separate follow-up request; this artifact case alone does not prove runtime behavior.

## pr-structure

### Task

Add record export from the CLI, and make the browser record list searchable. Split the work so I can review and accept each change independently.

This is an offline publishing exercise. Use local Git branches and commits; write each PR title, body, intended base and order under artifacts. Do not contact GitHub or create real pull requests.

### Criteria

- Split independent export and browser-search changes into independent branches on the baseline.
- Keep each branch runnable alone and preserve import behavior.
- Assign each hunk to exactly one PR; keep shared dependencies in a real parent only when needed.
- Replay branches independently and together in disposable checkouts; test merge-tree for conflicts.
- Put the user-visible behavior and its evidence in each PR body.

Judge the structure from actual commits and diffs, not a proposed stack diagram. Reject empty layers, duplicated patches, unrelated formatting and a stack added without a dependency. No live publishing is required; this case does not claim to evaluate host notifications or pipeline scheduling.

## visual-proof

### Task

Show me that importing a file through the browser writes the records I can read afterward. I want proof I can understand on my phone.

### Criteria

- Record the real browser import and the resulting durable records with matching data.
- Show input, action and result in one complete journey, not a screenshot of an idle page.
- Keep text and the final result readable on a phone; inspect the captured files.
- Open on the real action, remove idle time and redundant introductions, and make camera moves arrive before input.
- Replay the final encoded video to inspect transitions. Stills and a nominal frame rate do not establish smooth motion.
- Keep the tested preview and shared tab open with their real HTTPS URL. Do not label a development watcher as a built preview.
- Use the real application, never a mock, terminal illustration or invented screenshot.
- Make no product-code changes just to manufacture a successful capture.

Judge whether the evidence establishes the claim, separately from the application's design. Inspect metadata and replay the media; missing evidence is missing, not a passing text assertion.
