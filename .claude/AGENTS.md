# Personal agent configuration

| Owner                                                            | Decision                                                                                                                                                      |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.claude/agents/pair.md`                                         | Shared personal instructions; `.codex/instructions.md` aliases this file                                                                                      |
| `.claude/skills/workflow`, `environment`, `maintenance`, `media` | Maintained personal procedures; matching Codex paths alias these directories                                                                                  |
| Engineering, design and testing in both native roots             | Generated repository copies; edit [package sources](../tools/coding-standards/skills/), then [refresh locally](../tools/coding-standards/README.md#decisions) |
| `.claude/AGENTS.md`                                              | Shared brief; `.codex/AGENTS.md` aliases it                                                                                                                   |
| Native settings                                                  | Harness-specific capabilities, not another copy of workflow or coding policy                                                                                  |

Install personal configuration with the [environment procedure](skills/environment/references/deslop.md#install-personal-configuration).

Machine upkeep remains in maintenance. Update this brief when these ownership decisions change, not for every implementation edit.

## Decisions not to repeat

| Rejected approach                                     | Reason                                                                                   |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Mandatory delegation and model ladders                | Coordination became the work; delegation stays conditional                               |
| Production polish before prototype feedback           | Unaccepted directions must stay cheap to replace                                         |
| Progress ledgers or PR recaps in chat                 | T3 and the PR show them; the closing Status table states only head, pipeline and pending |
| Repeated instruction-simulation rounds                | They tested decisions, not real-task speed; rerun only for a consequential open question |
| Rebuilding orchestration or review surfaces           | Out of scope unless T3 and artifacts cannot supply a requested capability                |
| Importing Emil's whole skill collection               | Its variant picker, audit fan-out and style defaults conflict; keep the targeted craft   |
| Splitting short core design standards into references | Alignment, overflow and interaction essentials stay inline                               |
| Telegraphic, slash-heavy instruction prose            | Agents copied it into briefs with glued words                                            |
| Coordination protocols between children               | A checker idled behind GO and PAUSE gates while source changed                           |
| Jira, Linear or other tracker connectors              | The user does not want them                                                              |
| Implementation children, even with separate files     | In one checkout they queued on the test lock, waited on gates and reformatted each other |
| Nested delegation                                     | No case justified a second level; finished children kept acting on pipeline events       |
| Review fix rounds until clean                         | One day produced 28 review tasks, many one-minute checks of one-line fixes               |
| Formatter and autofix rewrites outside the task       | They put unrelated files into pull requests and widened lint migrations                  |
| Codex `model_context_window` override                 | Primary calls carried a median of 264k tokens; the recommended window compacts sooner    |
| Commit series or stacked pull requests for review     | The user chose a contract-focused pull request body instead                              |

<details>
<summary>Workflow and agent references</summary>

| Source                                                                                                                                                             | Used and boundary                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Factory skills](https://docs.factory.com/harness/skills) and [AGENTS.md](https://docs.factory.com/harness/agents-md)                                              | Scoped task triggers and concise project context; no Factory harness installed                                                                               |
| [Amp skills](https://ampcode.com/docs/customize/skills), [tools](https://ampcode.com/docs/tools), [prompting](https://ampcode.com/docs/prompting)                  | Native capabilities and bounded context; no second coordinator                                                                                               |
| [T3's agent brief](https://github.com/pingdotgg/t3code/blob/5a96895a85b43c838da6c89cf21068b99c003d5a/AGENTS.md)                                                    | App-owned orchestration rather than duplicate thread and status machinery                                                                                    |
| [Pi's agent prompt](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent) and [Steipete's agent scripts](https://github.com/steipete/agent-scripts) | Reviewed builder harnesses; not installed as another launcher or sync framework                                                                              |
| [gstack](https://github.com/garrytan/gstack)                                                                                                                       | Reviewed direct communication and browser practice; rejected its preambles, status protocol and staged framework                                             |
| [pstack](https://github.com/cursor/plugins/tree/main/pstack) and [Poteto's interview with Matt Pocock](https://www.youtube.com/watch?v=MN9dGgmLyso)                | Plain language without over-compression and recurring mistakes encoded as structure; not its playbook router, review until a clean pass or autopilot merging |

Public engineering, testing and design provenance belongs in the [coding-standards brief](../tools/coding-standards/README.md#skill-sources), not repeated in runtime instructions. Social clips helped find repositories; unavailable captions and ambiguous identities are not evidence of an adopted rule.

</details>
