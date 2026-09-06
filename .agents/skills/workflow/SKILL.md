---
name: workflow
description: "Use to improve this user's Codex instructions, delegation, roles, skills, configuration, and workflow tooling."
---

## Priorities

- Primary's expensive context is a deliberate constraint. Preserve its configured delegation boundary; reduce cost through complete specialist assignments, compact findings, and fewer repeated investigations, not by moving tool work into Primary.
- Communication is a user-designed interface, not formatting clutter. Preserve the global communication rules unless changing them is part of the user's request.
- Optimize for this user's actual environment and work. Do not turn the workflow into a general framework, add support for hypothetical hosts, or create packages for one-off scripts.
- Prefer removing an unnecessary instruction, abstraction, handoff, or artifact to adding another rule. Fewer words are useful only when the required behavior stays clear.

## Owners

Paths below are relative to the repository root. Edit the versioned owner, not its installed copy.

| Concern                                                                      | Owner                                                                         |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Global environment, conduct, and communication                               | `.agents/AGENTS.md`                                                           |
| Primary decisions and routing; models, tools, and personal Codex preferences | `.agents/config.toml`                                                         |
| Specialist method, restrictions, and terminal result                         | `.agents/roles/<role>.toml`                                                   |
| Code-quality decisions                                                       | `.agents/skills/engineering`                                                  |
| Repository validation and data policy                                        | `AGENTS.md`                                                                   |
| Repository architecture and conventions                                      | `.agents/skills/project-engineering`                                          |
| Workflow maintenance decisions                                               | This skill                                                                    |
| Workflow configuration                                                       | `tools/configure-workflow.ts`, invoked by `vp run scripts:configure-workflow` |

## Improve the cause

- Before designing around existing behavior, distinguish current requirements from inherited machinery. Discuss a smaller ownership or replacement boundary when it would remove substantial complexity; do not silently preserve old behavior as a requirement.
- Start from the user's observed friction. Trace it to the instruction, routing decision, tool capability, or script that controls it. Use relevant session evidence when available; distinguish an observed failure from a predicted risk.
- For wasted Primary tokens, inspect task boundaries, brief size, raw output leakage, repeated research, and unnecessary specialist lifecycle churn. Do not assume that fewer agents means lower cost.
- For stalled or incomplete work, inspect ownership, completion conditions, correction routing, and whether the requested tool exists in the active host. Do not compensate for unavailable capabilities with stronger prose.
- For duplicated policy, keep the controlling rule with its owner and remove restatements. Check whether apparently repeated text is delivered to a different role or runtime context before deleting it.
- For instruction cleanup, remove conflicting, duplicated, superseded, or inactive guidance established by current evidence. Keep concrete constraints that prevent known failures; do not replace them with vague advice to use judgment.
- Keep skill metadata to its trigger. Put only needed conditional depth in references. Do not add READMEs, glossaries, checklists, stages, or test harnesses that merely restate or exercise the implementation.

## Verify the affected outcome

- Check that the edited rule reaches the intended role and that its consumers still agree. Source files, installed Codex settings, and host-injected instructions are different inputs; do not assume a repository edit is active in the current session.
- Follow the root validation commands. Exercise changed installer behavior against a temporary home; keep live installation separate from source validation. Do not add backup, merge, migration, or fallback behavior to a versioned setup unless the user requires it.
- Use the configured Evaluation role for changed runtime claims. Editorial changes do not need a new behavioral campaign. A successful config load proves parsing, not delegation, context isolation, or lifecycle behavior.
- Finish with the approved change complete in its existing owners, obsolete paths removed, and any unverified behavior stated plainly. Do not leave cleanup for another role or add a new process artifact to record completion.
