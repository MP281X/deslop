# Personal agent configuration

| Owner                                                            | Decision                                                                                                                                                         |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.claude/agents/pair.md`                                         | Shared personal instructions; `.codex/instructions.md` aliases this file                                                                                         |
| `.claude/skills/workflow`, `environment`, `maintenance`, `media` | Maintained personal procedures; matching Codex paths alias these directories                                                                                     |
| Engineering, design and testing in both native roots             | Generated repository copies; edit [package sources](../tools/coding-standards/skills/), then [refresh locally](../tools/coding-standards/README.md#working-here) |
| `.claude/README.md`                                              | Shared native-configuration brief; `.codex/README.md` aliases it; both `AGENTS.md` files point to their local `README.md`                                        |
| Native settings                                                  | Harness-specific capabilities, not another copy of workflow or coding policy                                                                                     |

Personal installation uses [named, preimage-guarded targets](skills/environment/references/deslop.md#install-personal-configuration); never copy/reset a whole native root. Preserve newer installed changes, sign-ins and unrelated configuration.

Machine upkeep remains in maintenance; this brief owns native-configuration decisions. Update it when these ownership decisions change, not for every implementation edit.

## Decisions not to repeat

| Rejected/tried approach                               | Reason to retain                                                                                                                        |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Mandatory delegation, model ladders and review rounds | User rejected coordination becoming the work; keep delegation conditional, not a stage checklist                                        |
| Production polish before prototype feedback           | User rejected spending heavily on an unaccepted direction; disposable trials must remain cheap to replace                               |
| Another progress ledger or copied PR recap in chat    | T3 and the PR already own those views; duplication makes the user reconcile multiple representations                                    |
| Repeated instruction-simulation rounds                | Prior scenarios checked agent decisions, not real-task speed; repeat only for a consequential unresolved uncertainty                    |
| Rebuilding native orchestration/review surfaces       | Not this harness's scope; revisit only for an explicitly requested capability existing T3/artifacts cannot supply                       |
| Importing Emil's whole skill collection               | Keep targeted layout/motion/mobile craft; its fixed variant picker, audit fan-out and style/library defaults conflict with this harness |

| Splitting short core design standards into references | User prefers alignment, overflow and interaction essentials available directly; reserve references for genuinely long optional material |
| Telegraphic, slash-heavy instruction prose | Agents copied it into briefs with glued words and private abbreviations that children echoed back; instructions use whole plain sentences |
| Coordination protocols between children (gates, GO, PAUSE, acknowledgements) | They kept a checker idle while source changed; start checks on final source or do coupled work in the primary |
| Handing the user a preview URL to try, or waiting for it before pushing | The user judges trials from screenshots and video in the thread; previews are on request, and a finished review loop pushes |

## Workflow and agent references

| Source                                                                                                                                                             | Used / boundary                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Factory skills](https://docs.factory.com/harness/skills) and [AGENTS.md](https://docs.factory.com/harness/agents-md)                                              | Scoped task triggers and concise project context; no Factory harness installed                                                                              |
| [Amp skills](https://ampcode.com/docs/customize/skills), [tools](https://ampcode.com/docs/tools), [prompting](https://ampcode.com/docs/prompting)                  | Native capabilities and bounded context; no second coordinator                                                                                              |
| [T3's agent brief](https://github.com/pingdotgg/t3code/blob/5a96895a85b43c838da6c89cf21068b99c003d5a/AGENTS.md)                                                    | App-owned orchestration rather than duplicate thread/status machinery                                                                                       |
| [Pi's agent prompt](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent) and [Steipete's agent scripts](https://github.com/steipete/agent-scripts) | Reviewed builder harnesses; not installed as another launcher or sync framework                                                                             |
| [gstack](https://github.com/garrytan/gstack)                                                                                                                       | Reviewed direct communication/browser practice; rejected its preambles, status protocol and staged framework                                                |
| [pstack](https://github.com/cursor/plugins/tree/main/pstack) and [Poteto's interview with Matt Pocock](https://www.youtube.com/watch?v=MN9dGgmLyso)                | Plain-language and over-compression rules, recurring mistakes encoded as structure, review until a clean pass; not its playbook router or autopilot merging |

Public engineering/testing/design provenance belongs in the [coding-standards brief](../tools/coding-standards/README.md#skill-inspiration), not repeated in runtime instructions. Social clips helped find repositories; unavailable captions and ambiguous identities are not evidence of an adopted rule.
