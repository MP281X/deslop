# Personal agent configuration

| Owner                                                 | Decision                                                                                                                                                      |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.claude/agents/pair.md` and `.codex/instructions.md` | Separate system prompts that replace each harness's built-in prompt: the built-in parts worth keeping, then the same pair rules in both                       |
| `.claude/skills/workflow` and `environment`           | Personal skills; maintenance and media are environment references; Codex paths alias the directories                                                          |
| Engineering, design and testing in both native roots  | Generated repository copies; edit [package sources](../tools/coding-standards/skills/), then [refresh locally](../tools/coding-standards/README.md#decisions) |
| `.claude/skills/retrospective`                        | Repository-only skill for thread analysis and prompt evals; never installed on workers, because it edits this repository's configuration                      |
| `.claude/AGENTS.md`                                   | Shared brief; `.codex/AGENTS.md` aliases it                                                                                                                   |
| Native settings                                       | Harness-specific capabilities, not another copy of workflow or coding policy                                                                                  |

Install personal configuration on every worker with the [environment procedure](skills/environment/references/maintenance.md#agent-configuration).

Machine upkeep lives in environment's maintenance reference. Update this brief when these ownership decisions change, not for every implementation edit.

## Decisions not to repeat

| Rejected approach                                                           | Reason                                                                                                                             |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Model ladders                                                               | Coordination became the work; children explore, the primary keeps every write                                                      |
| Production polish before prototype feedback                                 | Unaccepted directions must stay cheap to replace                                                                                   |
| Progress notes, Status tables or PR recaps in chat                          | T3 shows children, commits, pushes, the PR and its pipeline; the user reads only what adds to that                                 |
| Installing instruction changes without an eval and the user's approval      | Each change gets one quick blind eval of old against new prompts on real scenarios; the user approves before install               |
| Repeated instruction-simulation rounds                                      | They tested decisions, not real-task speed; one quick eval per change is enough                                                    |
| Rebuilding orchestration or review surfaces                                 | T3 threads, inline renders and the pull request supply them                                                                        |
| Importing Emil's whole skill collection                                     | Its variant picker, audit fan-out and style defaults conflict; keep the targeted craft                                             |
| Splitting short core design standards into references                       | Alignment, overflow and interaction essentials stay inline                                                                         |
| Telegraphic, slash-heavy instruction prose                                  | Agents copied it into briefs with glued words                                                                                      |
| Coordination protocols between children                                     | A checker idled behind GO and PAUSE gates while source changed                                                                     |
| Jira, Linear or other tracker connectors                                    | The user does not want them                                                                                                        |
| Implementation children, even with separate files                           | In one checkout they waited on gates and reformatted each other                                                                    |
| Nested delegation                                                           | No case justified a second level; finished children kept acting on pipeline events                                                 |
| Review fix rounds until clean                                               | One day produced 28 review tasks, many one-minute checks of one-line fixes                                                         |
| Formatter and autofix rewrites outside the task                             | They put unrelated files into pull requests and widened lint migrations                                                            |
| Codex `model_context_window` override                                       | Primary calls carried a median of 264k tokens; the recommended window compacts sooner                                              |
| One thread per stack layer                                                  | A later request must land in the layer that owns it, not in the layer that is checked out                                          |
| Stacks without a reason to split                                            | The user wants layers only where a reviewer needs them apart                                                                       |
| A machine-wide lock and resource rules                                      | `desktop` has 24 threads and 31 GB swap; the user rejects rules shaped by machine limits, and nested lock names deadlocked a child |
| Tailscale SSH instead of keys                                               | The user chose one shared key pair; the Mac's Tailscale app cannot be an SSH server                                                |
| Copying sign-ins or configuration from another machine                      | The user can reset any machine at any time; each worker sets itself up, and the key pair comes from the user's backup              |
| Wake-on-LAN through the Mac                                                 | The Mac shares a network with `desktop` only when the user is home and can power it on by hand                                     |
| The Atlassian CLI                                                           | The user does not use it                                                                                                           |
| Package-level preset adoption in deslop                                     | Deslop's root config extends the preset for the whole repository; package adoption and changed-files-only ignores apply in Dual    |
| Updating Codex, Claude Code and T3 in maintenance                           | T3 updates all three itself                                                                                                        |
| Template checklists, video durations and a separate Proof section in bodies | The user reads a body as a changelog: each change with its own evidence and code links                                             |
| The harnesses' built-in writing style and progress updates                  | The user rejects both default outputs; the pair rules replace them                                                                 |
| One prompt file shared by both harnesses                                    | Each harness keeps different built-in rules, such as Claude's tool preference and Codex's channels                                 |
| Children writing full reports to scratch files                              | The user wants results in the thread, not side files                                                                               |
| A diff-classification command                                               | The user does not want another CLI; the cleanup audit procedure covers it                                                          |
| Verification children running checks                                        | Checks write shared outputs; the primary runs them                                                                                 |
| Rerunning Finish and Deliver for every later change                         | Each pass cost hours; a later change returns to Build and reruns only its hunks                                                    |
| Full validation after a small change                                        | Repeated root checks and builds; the ledger reruns only checks whose inputs changed                                                |
| Rendering a plain list or prose as HTML                                     | A render replaces text with screens, flows, timelines, options or change maps; it never restyles the same words                    |
| Patching single cases of a repeated failure                                 | The same defects recurred across threads; fix the code, rule or setting that causes them                                           |
| References inside the shared skills                                         | Tested: split rules made engineering, design and testing results less consistent; only workflow and environment keep references    |
| Thread briefs that restate the workflow                                     | Every rule change then needed a steer; briefs carry the plan and task decisions only                                               |
| Re-reviewing a whole branch and fixing style findings                       | A repeat review of 400 files returned 25 findings each and drew restyling across unrelated files                                   |
| Asking every decision in one batch                                          | The Dual Apps brainstorm sent 18 questions in 5 cards and got 9 "not sure" answers; frontier rounds replaced it                    |
| Status text between tool calls, including Codex commentary                  | T3 shows it as a full message until the turn ends; the pair prompts list three exceptions                                          |
| Links, paths or markdown in question cards                                  | T3 renders card text as plain text                                                                                                 |
| A question card after a guide with a link                                   | In the VPN thread the guide stayed in thinking and the card had no link; a guide now ends the turn                                 |
| Display rules from memory                                                   | Agents assumed cards hide text and `<details>` hides on the phone; What T3 shows comes from T3 source                              |
| Harness hooks that steer agent behavior                                     | The user wants prompt-level fixes; a hook that blocked sliced reads was rejected                                                   |
| Codex as the primary agent                                                  | Slower than Claude on two Dual build tasks in the eval: 4 to 8 minutes against 2 to 7                                              |
| Analysis scripts inside the retrospective skill                             | Scripts change with every analysis; the skill keeps the measures and the inline commands                                           |

<details>
<summary>Workflow and agent references</summary>

| Source                                                                                                                                                             | Used and boundary                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Factory skills](https://docs.factory.com/harness/skills) and [AGENTS.md](https://docs.factory.com/harness/agents-md)                                              | Scoped task triggers and concise project context; no Factory harness installed                                                                               |
| [Amp skills](https://ampcode.com/docs/customize/skills), [tools](https://ampcode.com/docs/tools), [prompting](https://ampcode.com/docs/prompting)                  | Native capabilities and bounded context; no second coordinator                                                                                               |
| [T3's agent brief](https://github.com/pingdotgg/t3code/blob/5a96895a85b43c838da6c89cf21068b99c003d5a/AGENTS.md)                                                    | App-owned orchestration rather than duplicate thread and status machinery                                                                                    |
| [T3 web and iPhone clients](https://github.com/pingdotgg/t3code/tree/30cc788975500a8c00d32a50f348174d1ce578d1/apps)                                                | Source of What T3 shows in the pair prompts; recheck it there when T3 changes a fold, card or notification                                                   |
| [Pi's agent prompt](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent) and [Steipete's agent scripts](https://github.com/steipete/agent-scripts) | Reviewed builder harnesses; not installed as another launcher or sync framework                                                                              |
| [gstack](https://github.com/garrytan/gstack)                                                                                                                       | Reviewed direct communication and browser practice; rejected its preambles, status protocol and staged framework                                             |
| [pstack](https://github.com/cursor/plugins/tree/main/pstack) and [Poteto's interview with Matt Pocock](https://www.youtube.com/watch?v=MN9dGgmLyso)                | Plain language without over-compression and recurring mistakes encoded as structure; not its playbook router, review until a clean pass or autopilot merging |

Public engineering, testing and design provenance belongs in the [coding-standards brief](../tools/coding-standards/README.md#skill-sources), not repeated in runtime instructions. Social clips helped find repositories; unavailable captions and ambiguous identities are not evidence of an adopted rule.

</details>
