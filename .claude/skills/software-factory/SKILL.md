---
name: software-factory
description: Takes the user from an idea to merge-ready pull requests, with plans, prototypes, stacks, reviews and delegation. Use for any task that changes and ships code or configuration, for every T3 notice about a pull request, and for code reviews, cleanup audits, critiques, instruction reviews and pull request body checks; plain questions use explore, and delegated work uses only its assigned procedure.
---

# Software factory

Deliver merge-ready pull requests without the user in the loop. Get the result right before you show it, because each fix round costs him a review. His only gate is the merge.

## 1. Prepare

Keep this table in your notes and in child briefs, never in a file or a message:

| Field     | Content                                                                                |
| --------- | -------------------------------------------------------------------------------------- |
| Intent    | The outcome the user wants, in one or two lines                                        |
| Ticket    | Each requirement of the pasted tickets and comments as a claim, with its source quoted |
| Decisions | Choices already made, including what stays                                             |
| Access    | Accounts, tokens and services the work needs, and who provides each                    |
| Size      | The smallest version that meets the intent, in files and pull requests                 |
| Done when | Observable behavior, proof and pull request state                                      |

- **Explore.** Before the first question, start parallel lookup children per [explore](../explore/SKILL.md) on the touched code, its consumers, existing capabilities, named references and earlier threads.
- **Plan.** Before product code, render the plan for the user to try: the user journey, every screen state, what changes and what stays, and each decision beside the behavior it changes. Put deal-breakers first, such as an expiring login or a lost feature. For an open approach, start a [council](../explore/SKILL.md#council) first, then show two or three directions per design's Variants rule. Iterate on the render with his steers.
- **Start.** Write each planned behavior as a one-line claim that is true or false. When the pair prompt's Questions rule leaves nothing to ask, start Build at once.
- **Scope.** The request is the scope. List related improvements and defects outside it under **Decided** with their size, and leave them out.

## 2. Build

- **Real thing.** Build the chosen plan in the real app with realistic data. Share the preview as soon as it works, and record each journey's proof video when its iteration settles, not at delivery.
- **Background review.** When an iteration settles a pull request's code, start one [code review](references/review.md#code-review) and one [cleanup audit](references/review.md#cleanup-audit) per area in the same response as its commit. Under 50 hand-written lines, one child does both. Their briefs quote every user message verbatim, never the plan. Keep building, and in the next iteration apply every confirmed finding and every Cut and Simplify row. Keep a flagged part only when the user's words need it, and list it under **Decided**.
- **Checks.** Use focused checks while you iterate; they never replace the root commands.
- **Ready.** When the result meets the claims and the findings are applied, continue to Finish without asking.

## 3. Finish

- **Cover.** Every hand-written hunk needs a review and a cleanup audit of its final code. Reuse the background rounds, and start one more review and audit round only for the hunks they missed. A direct fix of a confirmed finding needs no new review. Add an [instruction review](references/review.md#instruction-review) for a consequential instruction or configuration change.
- **Simplify.** Then run one cleanup audit over the whole diff against the default branch, which also answers what can be superseded, standardized on existing primitives or cut from scope. Apply every row before delivery.
- **Prove.** Run the root fix, check and test commands. Prove each ticket requirement with the outcome a user sees, per the [capture rules](references/captures.md#rules).

## 4. Deliver

- **Ship.** Fetch, rebase onto `origin/<default branch>` and rerun the root commands. After a manifest or lockfile change, verify a frozen install. Publish only reviewed and tested code, per [Stacks](#stacks); failing local checks block the push. Push every changed pull request of an iteration at once, because each push restarts the pipelines above it. Write each body from the [example body](references/publishing.md#example-body), and edit a title or body only after the push it describes.
- **Check.** Link each pull request with `link_pull_request` only: the link action of `t3_thread_update` replaces and unlinks the thread's previous link. Watch each pushed pull request with `watch_pull_request`. Run one [body reader](references/review.md#body-reader) per body, and fix what it confirms. While only pipelines run, end the turn with no text. A notice about an older head or a running job changes nothing: end the turn with no text.
- **Mark ready.** When every required job passes on the exact final heads, mark each pull request ready (`gh pr ready <number>`, `glab mr update <number> --ready`) and, in the same step, call `write_pull_request_guides` with all of them, even when you expect it to fail. Then run Hand off, call `html_render` with the pair prompt's Overview, and reply without check, test or pipeline results.
- **Hand off.** Unwatch every pull request. Stop everything you started, except evidence and the previews environment keeps. Give a manual test guide only for what you did not prove.
- **Later changes.** A later request runs [Back to draft](#stacks) before the first edit, updates the plan, shows it and returns to Build. Review and audit only its hunks and their consumers, rerun the root commands and the affected captures, push only the changed pull requests, and run Mark ready again.

## Stacks

The user reviews pull requests one at a time and squash-merges each at once. Unrelated changes are independent pull requests on the default branch. A change that builds on another stacks on it, and the user merges a stack bottom up.

- **Split.** Plan the pull requests before the first commit, without asking. Split only unrelated topics and changes over 1,500 hand-written lines; generated files stay with their source. A later request on a published topic goes into that topic's pull request, not a new layer. A cleanup pull request, when needed, holds root fix changes on untouched lines and removed superseded code and suppressions.
- **Independent.** An independent pull request holds only what it needs to apply alone. A change that two pull requests need, such as a lockfile change, goes in the lower one, and the other stacks on it. Before each publish, run `git merge-tree --write-tree <branch> <other branch>` for each pair of independent pull requests, and move a conflicting change into one of them.
- **Chain.** Keep one commit per pull request on `<thread branch>-chain`, dependencies first. Put each change in its owning commit with `git commit --fixup=<commit>`, then `git rebase --autosquash origin/<default branch>`.
- **Publish.** Rebuild each branch with `git switch -C <branch> <base> && git cherry-pick <commit>`; the base is `origin/<default branch>` or the dependency's branch. Name the first branch after the thread and the others `<thread branch>-<n>-<topic>`. Open each as a draft against its base, never with `gh stack`'s `--open`, switch back to the chain, and push with `--force-with-lease`. Run each push as its own command: the deny list blocks any command that holds a push and the default branch's name. On GitHub, link a stack with `gh stack link <numbers, bottom first>`.
- **Reuse.** A new split reuses the open pull requests and their branch names: force-push, then edit titles, bases and bodies. Run `gh stack unstack <stack number>` before you reorder or drop a linked pull request, then link again. Close only a pull request whose content moved, with a comment that names where.
- **Back to draft.** Before you change a ready pull request, make it a draft. GitHub: `gh api graphql -f query='mutation($id: ID!) { convertPullRequestToDraft(input: {pullRequestId: $id}) { pullRequest { isDraft } } }' -F id=$(gh pr view <number> --json id -q .id)`. GitLab: `glab mr update <number> --draft`.
- **Merges.** After a merge, fetch and rebase the chain onto `origin/<default branch>`, republish only the pull requests whose base or diff changed, unlink the merged one with `unlink_pull_request`, and run Mark ready again. A linked GitHub stack retargets itself; on GitLab, retarget the next merge request.

## Always

- **Build outputs.** Never run two commands that write the same build outputs at once.

## Delegate

The primary is always an expensive model and keeps every write, root command, build and browser session. Children are read-only and run on the model the pair prompt's Children rule names. Start children in parallel and in the background, and keep working.

| Task               | Start one for                                           | Procedure                                         |
| ------------------ | ------------------------------------------------------- | ------------------------------------------------- |
| Lookup             | Each well-defined question: find, trace, count, measure | [explore](../explore/SKILL.md)                    |
| Council            | An open question: ideas, directions, a brainstorm       | [council](../explore/SKILL.md#council)            |
| Code review        | Each area of a settled pull request, or a risk          | [review](references/review.md#code-review)        |
| Cleanup audit      | Each area of a settled pull request                     | [review](references/review.md#cleanup-audit)      |
| Body reader        | Each published pull request body                        | [review](references/review.md#body-reader)        |
| Critique           | The recommended direction                               | [review](references/review.md#critique)           |
| Instruction review | Each consequential instruction or configuration change  | [review](references/review.md#instruction-review) |

- **Briefs.** Each brief holds the user's request verbatim, the plan table except in review and audit briefs, the task's decisions, the procedure path, the checkout, the sources and the return format. It never restates this skill.
- **Rounds.** Message a running child only with a fact that changes its next action. Each review round is a new `delegate_task` whose brief lists every earlier finding and its verdict. When a child returns, reconcile every missing or failed criterion.
- **Fixes.** Fix every confirmed finding of a review of the user's own code or configuration. A review of someone else's pull request only reports.

## Owners

`CODING_STANDARDS.md` holds repository contracts, a folder's `AGENTS.md` holds its decisions, and environment holds machine facts. Read the owner before you work in its area, and update it when a decision changes. Record only what the code cannot show: rejected options, non-goals and failed attempts.
