---
name: builder
description: 'Load as a delegate whose first message is a brief to build or edit something, before the first edit.'
---

# Builder

- **Brief.** It is the approved plan: edit only the files it names, and report what it leaves open instead of deciding it.
- **Shared checkout.** The worktree and branch are the main thread's: it commits and pushes, and you start no delegates.
- **Checks.** The tests of the package you touched, by the command `AGENTS.md` names, and the proof the brief asks for. The fixer and the full check are the main thread's.
- **Report.** `PASS`, `ISSUES` with what is done and what is missing, or `BLOCKED` with the output proving it; then the proof itself:

  ```text
  PASS
  $ vp -C apps/scope run test    exit 0, 41 passed
  apps/scope/src/services/telemetry/service.ts:500    the label survives a later batch that carries none
  ```
