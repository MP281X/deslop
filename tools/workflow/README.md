# Codex workflow

The repository versions the complete reusable workflow: global conduct and communication, primary instructions and model configuration, specialist roles, engineering guidance, and the source catalog. Repository-specific validation, data policy, architecture, and visual conventions remain in the root `AGENTS.md` and `.agents/skills/project-engineering`.

## Install

Run the npm package with Node.js 26 or newer:

```bash
vpx @deslop/workflow
```

The installer copies into `${CODEX_HOME:-$HOME/.codex}`. It replaces `config.toml`, `AGENTS.md`, `agents/deslop`, and the `engineering` and `workflow` skill directories. Other agents, skills, credentials, session data, and historical backup directories are preserved. Existing settings inside the owned paths are deleted rather than merged or backed up.

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
| Rendered acceptance with host capabilities      | `assets/codex/agents/browser.toml`        | gpt-5.6-sol low     |
| Agent-runtime behavioral proof                  | `assets/codex/agents/evaluation.toml`     | gpt-5.6-sol low     |
| Authorized GitHub and GitLab publication        | `assets/codex/agents/git.toml`            | gpt-5.6-sol low     |
| Product engineering and source index            | `assets/skills/engineering`               | Working specialists |
| Reusable workflow changes                       | `assets/skills/workflow`                  | Working specialists |

The primary handles initial planning with the user, dispatches configured roles with no inherited conversation history, corrects supported defects autonomously, and returns the completed result for the user's final review. Role files replace primary developer instructions in the child. Specialists return compact authoritative terminal evidence; the primary owns the user-facing report and does not repeat their searches or checks. Reuse a session for its corrections through `followup_task`. The configured concurrent-thread limit is six.

Explore maintains only needed source checkouts under `/tmp/deslop/repos`, using the catalog in `assets/skills/engineering/references/sources.md`. Reference repositories are not auto-cloned at startup. OpenCode can remain a research reference but is no longer a workflow dependency.

## Native constraints

The configuration targets Codex CLI `0.153.3` (`rust-v0.153.3`). Its V2 tools support role selection and clean-context spawning. The configuration preserves Codex's native system prompt and uses `developer_instructions` for role policy; it does not replace the model's system instructions.

Codex does not expose a generic built-in tool allowlist for the primary alone. Disabling shell in the parent also prevents children from enabling it. The primary's prohibition on direct research, shell, editing, and browsing is therefore an instruction, not hard tool isolation. No unsupported permission keys or custom runtime are added.

Install the package on each machine that runs Codex and start a fresh session afterward. The model identifiers and configured roles must be available to the signed-in account, and each host can override configuration or tool availability. Verify the effective host binding in that fresh session before treating the workflow or a capability as active. Browser uses agent-browser for web criteria and host-provided native computer interaction for desktop criteria.

Source contracts: [agent configuration](https://github.com/openai/codex/blob/rust-v0.153.3/codex-rs/config/src/config_toml.rs), [V2 settings](https://github.com/openai/codex/blob/rust-v0.153.3/codex-rs/features/src/feature_configs.rs), [role application](https://github.com/openai/codex/blob/rust-v0.153.3/codex-rs/core/src/agent/role.rs), and [AGENTS.md loading](https://developers.openai.com/codex/agent-configuration/agents-md).

## Installer verification

```bash
vp run test
```

The test uses a temporary home. It covers installation, full replacement of owned paths on reinstall, and preservation of unrelated files. It does not exercise authenticated model sessions or establish behavioral compliance with role instructions.

## Publication

GitHub Actions builds and tests this package on pushes. On `main`, it assigns version `0.0.<run-number>` before building, then publishes publicly to npm with provenance through `vp pm publish`, following the former Workbench release flow. Configure the npm trusted publisher for `MP281X/deslop` and `deploy.yaml` with direct publishing enabled before the first CI release. Package creation and npm account configuration are external prerequisites; the repository does not provision them.
