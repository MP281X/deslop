---
name: delivery
description: Branches, pull requests, publishing, readiness and visual proof. Use when structuring or publishing changes, writing review artifacts, recording screenshots or video, or handling pull request notices; orchestrator owns the implementation lifecycle.
---

# Delivery

## Branches

The user reviews and squash-merges one pull request at a time. Independent changes start from the default branch; dependent changes stack on their real dependency.

- **Split.** Settle PR boundaries before the first commit. Split unrelated topics and changes over 1,500 hand-written lines; keep generated files with their source. A later request on a published topic updates its existing PR. A cleanup PR holds root-fix changes on untouched lines and removed superseded code.
- **Independent.** Keep each branch runnable alone. Put shared required changes in a real parent. Before publishing, run `git merge-tree --write-tree <branch> <other branch>` for each independent pair and resolve overlapping ownership.
- **Chain.** Keep one commit per PR on `<thread branch>-chain`, dependencies first. Use `git commit --fixup=<commit>` and `git rebase --autosquash origin/<default branch>` to update its owning commit.
- **Publish branches.** Rebuild each thread-owned branch with `git switch -C <branch> <base> && git cherry-pick <commit>`; its base is the default branch or dependency branch. Open drafts, never use `gh stack --open`, and return to the chain. Push with `--force-with-lease`, one push per command; deny rules reject a command containing both a push and the default branch name. On GitHub, run `gh stack link <numbers, bottom first>`.
- **Reuse.** Reuse open PRs and branch names. Run `gh stack unstack <stack number>` before reordering or dropping a linked PR, then relink. Close only a PR whose content moved, naming its new location.
- **Back to draft.** Before editing a ready PR, use GitHub's `convertPullRequestToDraft` mutation or `glab mr update <number> --draft`.
- **After merges.** Fetch and rebase the chain onto the default branch; republish only changed bases or diffs and unlink merged PRs. GitHub stacks retarget themselves; retarget the next GitLab merge request.

## Publish and hand off

1. Fetch, rebase onto `origin/<default branch>` and rerun root commands. Verify frozen installation after manifest or lockfile changes. Failing local checks block publishing.
2. Push every changed PR of the iteration together. Set titles and bodies only after the push they describe; use the format below. Link each PR with `link_pull_request`, never the replacing link action of `t3_thread_update`, and watch each pushed PR.
3. Write the title, body and commit message once from the final change facts. Do not reread or self-check them, fetch them back after editing, or delegate an artifact review. Correct a known error or changed fact directly; review an artifact only when the user requests it or an evaluation targets it. While only pipelines run, use the core's nonempty external-wait reply. Ignore notices for older heads or running jobs.
4. When required jobs pass on the exact final head, mark that PR ready and start its T3 review guide in the same step. Never repeat a notice to the user. Commands: `gh pr ready <number>` or `glab mr update <number> --ready`.
5. Unwatch every PR and stop owned services except the tested preview environment keeps. Leave its visible tab and full tailnet HTTPS URL available. Give a manual guide only for user-only unproved behavior. The thread adds the whole-worktree picture, not another PR recap; T3 owns PR, agent, task and pipeline presentation.

## Visual proof

Use [captures](references/captures.md) to record, inspect and present screenshots and video. Testing owns whether the evidence proves the claim; design owns the application's interface.

## GitLab stacks

Stack ordinary merge requests by targeting each predecessor branch; publish and retarget with `glab mr create` and `glab mr update --target-branch`. The GitLab UI needs no stack feature.

Do not use `glab stack` in shared T3 worktrees: glab 1.122.0 stores both metadata and the active stack in the common Git directory. A second worktree can change which stack a command operates on. Keep the thread-owned chain and explicit MR targets above, without another stack manager.

## Example body

Describe each change that a user or caller notices across the whole branch against its target branch, each with its evidence. T3's review guide tours the code, so the body has no code links. Gaps, user actions and ticket status go in the final reply. Ignore the repository's template and checklist.

| Part      | Content                                                                                                                                         |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Opening   | One or two sentences: the central change in the user's terms and what it makes possible                                                         |
| Check     | Up to three bullets on what can break, such as a migration, a changed contract or removed behavior; omit it when nothing can break              |
| Entries   | One `###` heading per change, central change first, phrased as what now happens. Under it: at most two sentences, then its video or screenshots |
| Contracts | When public endpoints, schemas, flags, keys, migrations or exported APIs change: a before and after table, then the caller migration            |

- **Evidence.** Put each video or screenshot under the entry it proves: one complete video per realistic journey, at most eight screenshots, and no durations or timestamps.
- **Before and after.** Show a changed screen as a two-column table with the same data, the target branch on the left. When speed or size is the change, add a before and after table with the command that measured it.
- **Also.** A change with nothing to show keeps its heading and sentences. Group minor changes under one `### Also` entry as one-line bullets. The last bullet names the generated files and the command that reproduces them.
- **Leave out** pass counts, test tables, process notes, checklists, a proof section and anything that T3 or the pipeline shows.

```markdown
Integrations are now generated, not handwritten: the hosted catalog grows from 8 to 69 providers, and workflows start from their events.

- Deactivating Attio, Linear, GitHub or GitLab now deletes their webhooks.

### Provider events start workflow runs

A merge request starts a run and the run comments back; a forged token is rejected.

![A merge request starts a run](/uploads/<secret>/events-start-runs.mp4)

### The catalog keeps its rows while a filter loads

| Before                                                       | After                                                     |
| ------------------------------------------------------------ | --------------------------------------------------------- |
| ![Blank table](/uploads/<secret>/catalog-loading-before.png) | ![Rows kept](/uploads/<secret>/catalog-loading-after.png) |

| Request            | Before | After | Command                              |
| ------------------ | ------ | ----- | ------------------------------------ |
| Catalog list, warm | 2.4 s  | 90 ms | `curl -w '%{time_total}' <list URL>` |

### Plugins come from API descriptions

`dual openapi-plugin` turns an OpenAPI, GraphQL, MCP or Postman source into a versioned plugin. A lock file freezes released actions, so regenerating changes only the unreleased version.

### Also

- `src/generated/**` and `bun.lock` are generated: `dual openapi-plugin` reproduces them.

### Contracts

| Contract            | Before | After                               |
| ------------------- | ------ | ----------------------------------- |
| Application version | 5.0.0  | 6.0.0 selects the generated plugins |

Released application versions keep their plugins; nothing changes for existing workflows.
```

## Commands

**Publishing.** Pass bodies as files and put each capture under its entry. A successful edit command completes the artifact update; do not fetch it back for confirmation.

- **GitHub.** Write `![alt](./file.png)` in the body; `--attach` uploads the file and rewrites that reference. A video uses the same form.
- **GitLab.** `glab --attach` appends at the end, so upload each file through the API and paste the returned `markdown` under its entry. `glab` has no `--jq` option, so pipe into `jq`.

```bash
gh pr edit <number> --body-file <file> --attach './file.png#<alt text>'
token=$(glab config get token --host git.datapizza.tech) && curl -fsS -H "PRIVATE-TOKEN: $token" -F file=@<file> https://git.datapizza.tech/api/v4/projects/<project id>/uploads | jq -r .markdown
glab mr update <number> --description-file <file>
```

**Failed checks.** Read only the logs of failed jobs:

```bash
gh run view <run id> --log-failed
glab api "projects/<project>/pipelines/<pipeline id>/jobs?scope[]=failed" | jq -r '.[] | "\(.id) \(.name)"'; glab ci trace <job id>
```

**Baseline.** To compare with the target branch, commit a checkpoint, run `git restore --source=origin/<target branch> -- <paths>`, run the check, then run `git restore --source=<checkpoint> -- <paths>`. Reinstall after a restore that changes a manifest or lockfile. Use an extra worktree only when both versions must run at once, and remove it afterwards.
