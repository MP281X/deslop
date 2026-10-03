---
name: workflow-maintenance
description: 'Current personal workflow decisions and clean installation recipe. Repository-only; public coding skills live in tools/coding-standards.'
---

# Workflow maintenance

Keep the current decision and its reason here; rewrite changed decisions in place. Git and T3 history retain trials and superseded rulings. Execution rules belong to pair/workflow, coding rules to the public skills, repository decisions to CODING_STANDARDS.md and shared facts to environment. Task commands and bounded result formats live in their assigned procedures; repository-specific operations live in environment's Deslop/Dual references.

## Install

Run from this deslop worktree after changing its personal native configuration or skills. Read the sources and named targets first. Delete the owned configuration, roles and machine skills, then install their current sources; authentication, sessions and unrelated entries stay untouched. This replaces files, not a running session's loaded instructions.

```bash
set -e
CODEX_TARGET=${CODEX_HOME:-"$HOME/.codex"}
CLAUDE_TARGET=${CLAUDE_CONFIG_DIR:-"$HOME/.claude"}
rm -f "$CODEX_TARGET/config.toml" "$CODEX_TARGET/instructions.md" "$CLAUDE_TARGET/settings.json"
rm -f "$CODEX_TARGET/agents/"{explorer,review,worker}.toml "$CLAUDE_TARGET/agents/"{Explore,general-purpose,pair,review}.md
mkdir -p "$CLAUDE_TARGET/agents"
cp .codex/config.toml "$CODEX_TARGET/"
cp .claude/settings.json "$CLAUDE_TARGET/"
cp .claude/agents/pair.md "$CLAUDE_TARGET/agents/"
ln -s "$CLAUDE_TARGET/agents/pair.md" "$CODEX_TARGET/instructions.md"
for TARGET in "$CODEX_TARGET" "$CLAUDE_TARGET"; do
  rm -rf "$TARGET/skills/"{environment,maintenance,workflow,workflow-main,workflow-research,workflow-implementation,workflow-test,workflow-review,workflow-browser,engineering,design,testing}
  mkdir -p "$TARGET/skills"
done
cp -R .claude/skills/{workflow,environment,maintenance} "$CLAUDE_TARGET/skills/"
for SKILL in workflow environment maintenance; do
  ln -s "$CLAUDE_TARGET/skills/$SKILL" "$CODEX_TARGET/skills/$SKILL"
done
```

Compare installed files with their sources. Engineering/design/testing belong to the public repository installer, never global configuration; remove obsolete global copies. Do not change other repositories while installing this workflow.

## User preferences

- **Outcome.** Deliver merge-ready work with useful iterations and little user attention; optimize satisfaction, not reply length or nominal model cost.
- **Intent.** Rough requests evolve in one long feature/worktree thread through working examples, not a frozen ticket or factory handoff. Exploration follows uncertainty without special trigger words; the agent owns reversible technical choices and scheduling.
- **Alignment.** Try a thin real slice early, compare serious alternatives without building every conceivable direction, and challenge tentative ideas with evidence. Early alignment is cheaper than involving the user after a full build; agreed requirements and names are not tentative ideas.
- **Questions.** The user wants evidence-backed, self-contained choices without surrounding recaps or agent-owned decisions; pair owns the card format, and unclear answers are not consent.
- **Scope.** All agreed work belongs in the current PR without asking for order or whether to refactor touched code. Ask before expanding scope or removing a feature/service; do not substitute workarounds for a problem the agent cannot solve. Side notes do not displace the task.
- **Continuity.** No away mode, shown plans, user-authored tickets/specs or routine workflow/checklist output. Decisions stay in conversation; Done-when is private current state, not an append-only history or another user work queue.
- **Variants.** UI exploration presents at least five materially different versions of one small real slice as labeled, inspected desktop/phone captures, not a manual switcher journey. Reuse one host; settled-UI verification does not trigger five prototypes. The user preferred the original portfolio composition to denser grouped rows; reduced height alone was not a design improvement.
- **Proof.** Useful visual evidence is automatic; persistent/exposed previews are opt-in. No mandatory before/after pair or video of static output. Final check, independent whole-diff review and behavior proof remain deliberate requirements, not per-iteration gates or permission to ship sloppy prototypes.
- **Attention.** T3's subagent UI and history now provide task visibility; omit default progress tables and narrated agent updates. Keep decisions and evidence in the thread, with one PR review tour rather than a mirrored recap or external HTML plan. Disposable render hosts produce embedded images/video, then disappear.
- **Style.** Bold leading words and consistent terms reduce reading effort. No phase starts, percentages or checkpoint narration; answer requests and show meaningful completed results. Avoid unfamiliar abbreviations, arbitrary word caps or elapsed-time instructions in prompts. Show only examples that change understanding.
- **Delivery.** Commit only at delivery on the thread's existing branch; do not create/switch branches, write another branch or merge PRs. Default-branch updates flow into the working branch, never the reverse. Draft PRs use convention-matched titles and current whole-branch descriptions, not stacked iteration history; the user reviews in T3's PR tab and chose chat media for GitLab.

## Maintenance constraints

- **Root cause.** Resolve recurring friction at its owning source instead of adding contradictory rules or branches for one-off conditions. The workflow targets the happy path on this one machine; special instructions for one conversation do not become standing policy.
- **Evidence.** Use small real tests for the changed claim, not another broad benchmark round. Saving quota means removing repeated work, not assigning the user thinking the agent can do. Subscription cost is quota per merged PR (Claude Max 20x, Codex 5x), not API token prices; a stronger one-pass result can cost less than repeated cheap corrections.
- **Automation.** Personal workflow implementation stays prompts/config, not hooks, gates, generators, enforcement scripts or a production eval framework. External harnesses, patterns, model combinations and T3 settings remain authorized research/disposable offline experiments; investigation is not installation approval.
- **Isolation.** Evals never commit, push, create remote branches/PRs/MRs or perform destructive remote operations. Fixtures have no remote, invalid push destinations and invalid forge tokens; no copied authentication or repurposed HOME/CODEX_HOME. Use fresh T3-owned children, not terminal agents or sidebar conversations; top-level threads require explicit user request.
- **Read-only.** Dual and the rest of the host are read-only during repository workflow work. No dependency/account/proxy installations, host/VPN/home-worker setup, T3 upgrades or configuration changes without a selected evidenced direction. No shared provider-process restart merely to prove a setting.
- **Machine changes.** Authorized machine changes are versioned from deslop: facts/commands in environment, repeatable upkeep in maintenance. Requested cleanup is aggressive/full, without invented disk floors; superseded scratch is removed when settled, embedded proof retained. Public files never hardcode private tailnet addresses. No release-cooldown strategy is selected for Dual; deslop's cooldown is disabled.
- **Scheduling.** Daily 06:00 Europe/Berlin upkeep belongs to one reusable Maintenance thread on the main checkout, not feature worktrees or fresh sidebar threads. It is paused after cleanup deleted protected unattached Dual volumes; no verified recovery exists. Do not resume machine cleanup or enable the schedule without the user's instruction. A different cadence or mutating scope remains the user's decision.
- **Completion.** Completion means the evidence supports the user's objective, not just exhausted instructions or a green command; workflow/testing own validation and reporting.

## Ownership

- **Global.** Canonical personal sources live in .claude; .codex exposes explicit file/per-skill aliases, not a root symlink hiding skills from Git. Codex's base aliases the Claude pair. Install owns named native configs, obsolete roles, stale global public copies and workflow/environment/maintenance; repository-only workflow-maintenance and public generated skills are never copied. Preserve authentication, sessions and unrelated entries.
- **Local.** Public engineering/design/testing belong to tools/coding-standards, published together in @deslop/coding-standards and copied into every existing repository native root. Run the latest CLI transiently, independently of per-package preset versions; no root dependency for skill installation. Do not create unused roots; when none exists, create only .agents. This repository intentionally uses .claude/.codex without .agents or AGENTS.md; unique repository scope/tooling/generator decisions moved to CODING_STANDARDS.md. No compatibility alias for the rejected public naming/layout.
- **Boundary.** Public installation must preflight all selected native roots and skills ancestors before any writes, including dangling entries; reject global/outside-repository destinations. Canonical Git-root aliases and linked worktrees remain supported. Replace owned skill-name links without touching their external referents; preserve unrelated/private files. The public CLI does not install personal global workflow assets.
- **Rule owners.** First-pass code quality is the priority: one public skill set works without a deslop clone, engineering complements lint, testing stays distinct, CODING_STANDARDS.md owns repository taste, and design owns image/rendered work rather than a personal wrapper.
- **Quality changes.** Lint changes need real deslop/Dual validation and mutually consistent passing skill examples, without modifying Dual here; engineering owns generated-code and no-compatibility rules, and colleagues' CONTEXT.md, docs/adr/, CODING_STANDARDS.md and docs/agents conventions remain preferred.
- **Package migration.** Touched-package preset updates and cleanup are authorized by handwritten change size: substantial changes remove all rule weakenings, small changes remove now-empty exclusions, never an arbitrary percentage or repository-wide upgrade; environment owns the procedure.

## Routing decisions and qualified evidence

- **Primary.** Keep native configuration generic, the primary selectable in T3, and routing in one shared workflow rather than fixed provider identities or unused catalogues; native subscription sign-ins remain selected, not CLIProxy/auth translation.
- **Defaults.** Workflow owns Opus implementation/ideas, Sonnet replication, Sol code review/browser/images and Luna sources/checks; these practical defaults grant no verification waiver or universal ranking, and larger context is headroom, not bulk-reading authorization.
- **Code evidence.** In the small matched October 3 trials, Opus and Sol passed five code-contract checks and typecheck, but Opus left an inherited lint diagnostic while Sol cleared it. After implementation guidance required owning the whole assigned file's diagnostics, fresh Sonnet passed contract, format, lint and typecheck. Both code reviewers found three planted defects and left the correct control clean; both idea critiques chose the smaller skill hub. Opus identified global skill shadowing, Sol .codex-only discovery risk.
- **Browser evidence.** Claude operated keyboard state but missed initial internal clipping/cold favicon; Sol caught them. These bounded observations support the current split, not universal superiority, faster delivery, better subscription efficiency or proven satisfaction gains.
- **Delegation.** The user wants more aggressive direct delegation of independent substantive work, not recursive fan-out, an intermediate review manager, microtasks or blanket three-way reviews. The pair keeps taste/contracts/first instances/shared inputs/reconciliation, not every edit; coupled edits and short lookups stay local. Broad review can partition risk-bearing contracts while retaining cross-boundary integration; a coherent diff needs one reviewer. Three children was an experiment, not a standing cap.
- **Review evidence.** The Codex-only real-branch comparison covered 85 records: single Sol took 228 seconds/27 shell calls; three Sol leaves plus an experimental primary took 254 seconds/53 calls and found a global-skill symlink overwrite the single reviewer missed, reproduced before fixing. Different starts and an intervening whitespace correction prevent a controlled speed/quota conclusion. The useful result was added defect detection, not faster orchestration.
- **Authorization.** Earlier bounded Claude comparisons completed; the latest steer prohibits further Claude evals, not normal Claude implementation routing. Temporary quota-spending/fast overrides belong only to the current task: “fast mode only for now, not in the workflow itself”. No permanent priority-tier default.

Current task criteria and proof live in Done-when; durable trials and previous decisions live in Git/T3 history. Do not restore historical benchmark inventories or claim old successful checks prove a newly edited prompt.
