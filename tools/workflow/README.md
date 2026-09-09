# Codex workflow

The repository versions the complete reusable workflow: global conduct and communication, primary instructions and model configuration, specialist roles, engineering guidance, and the source catalog. Repository-specific validation, data policy, architecture, and visual conventions remain in the root `AGENTS.md` and `.agents/skills/project-engineering`.

## Install

Run the npm package with Node.js 26 or newer:

```bash
vpx @deslop/workflow
```

The installer copies into `${CODEX_HOME:-$HOME/.codex}`. It replaces `config.toml`, `AGENTS.md`, `agents/deslop`, and the `engineering` and `workflow` skill directories. It saves the prior owned files under `.deslop-backups` before replacement. Other agents, skills, credentials, and session data are preserved. Existing settings inside `config.toml` are replaced by the minimal versioned configuration; recover any required account-specific settings from the backup.

Run the newer package version to install its snapshot. Switching repository branches does not change the installed workflow. Restart Codex sessions after installation. The installer does not install Codex, Vite+, agent-browser, or authenticate accounts.

To inspect an installation without changing the live configuration:

```bash
vpx @deslop/workflow /tmp/deslop/codex-preview
```

The CLI uses TypeScript, Effect platform services, and a bundled Node executable. It has no Bash dependency. Claude Code support is outside this package.

From a source checkout, run `vp run build` in `tools/workflow`, then `node dist/main.js <codex-home>` from that directory.

## Ownership

| Responsibility                                  | Source                                    | Model               |
| ----------------------------------------------- | ----------------------------------------- | ------------------- |
| Shared conduct and communication                | `assets/AGENTS.md`                        | All roles           |
| Intent, scope, decisions, delegation, lifecycle | `assets/codex/config.toml`                | gpt-6-astra medium  |
| Neutral investigation and source upkeep         | `assets/codex/agents/explore.toml`        | gpt-5.6-luna low    |
| Implementation, cleanup, project validation     | `assets/codex/agents/implementation.toml` | gpt-5.6-sol low     |
| Independent static review                       | `assets/codex/agents/review.toml`         | gpt-5.6-sol medium  |
| Rendered acceptance with agent-browser          | `assets/codex/agents/browser.toml`        | gpt-5.6-sol low     |
| Agent-runtime behavioral proof                  | `assets/codex/agents/evaluation.toml`     | gpt-5.6-sol low     |
| Authorized Git/GitHub publication               | `assets/codex/agents/git.toml`            | gpt-5.6-sol low     |
| Product engineering and source index            | `assets/skills/engineering`               | Working specialists |
| Reusable workflow changes                       | `assets/skills/workflow`                  | Working specialists |

The primary dispatches configured roles with no inherited conversation history. Role files replace primary developer instructions in the child. Specialists return authoritative terminal results; the primary does not repeat their searches or checks. Reuse a session for its corrections through `followup_task`. Codex V2 releases execution capacity and unloads idle agents. Interrupt only active work that is no longer needed. The configured concurrent-thread limit is six.

Explore maintains only needed source checkouts under `/tmp/deslop/repos`, using the catalog in `assets/skills/engineering/references/sources.md`. Reference repositories are not auto-cloned at startup. OpenCode can remain a research reference but is no longer a workflow dependency.

## Native constraints

The configuration targets Codex CLI `0.153.3` (`rust-v0.153.3`). Its V2 tools support role selection and clean-context spawning. The configuration preserves Codex's native system prompt and uses `developer_instructions` for role policy; it does not replace the model's system instructions.

Codex does not expose a generic built-in tool allowlist for the primary alone. Disabling shell in the parent also prevents children from enabling it. The primary's prohibition on direct research, shell, editing, and browsing is therefore an instruction, not hard tool isolation. No unsupported permission keys or custom runtime are added.

The model identifiers must be available to the signed-in account. A host such as T3 Code or Codex Desktop can override configuration or tool availability; verify its effective settings before treating this workflow as active. No browser integration from those hosts is required: Browser uses agent-browser.

Global settings from the user's own machine were not available in the Work VM. This configuration does not copy the VM's account, provider, or runtime-specific settings.

Source contracts: [agent configuration](https://github.com/openai/codex/blob/rust-v0.153.3/codex-rs/config/src/config_toml.rs), [V2 settings](https://github.com/openai/codex/blob/rust-v0.153.3/codex-rs/features/src/feature_configs.rs), [role application](https://github.com/openai/codex/blob/rust-v0.153.3/codex-rs/core/src/agent/role.rs).

## Installer verification

```bash
vp run test
```

The test uses temporary homes. It covers copying, backups, replacement of obsolete owned files, preservation of unrelated files, and refusal to traverse symlinked managed parents. It does not exercise authenticated model sessions or establish behavioral compliance with role instructions.

## Publication

GitHub Actions builds and tests this package on pushes. On `main`, it assigns version `0.0.<run-number>` before building, then publishes publicly to npm with provenance through `vp pm publish`, following the former Workbench release flow. Configure the npm trusted publisher for `MP281X/deslop` and `deploy.yaml` with direct publishing enabled before the first CI release. Package creation and npm account configuration are external prerequisites; the repository does not provision them.

## ChatGPT Work

This CLI installs files for a local Codex runtime. Copying them into a hosted Work session does not register configured roles or add unavailable tools. The root repository `AGENTS.md` points directly to the shared conduct so it can be read from a checkout. Cross-session Work distribution requires a supported plugin; automatic context loading through a plugin hook requires hook trust and scripts available in the execution environment. This package does not claim that Work integration is active.
