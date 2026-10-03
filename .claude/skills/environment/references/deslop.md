# Deslop

**Root commands.** Vite+ tracks task inputs; cache checks, not source-mutating fixes. Use --no-cache when proving a fresh execution.

```bash
vp run --workspace-root --cache check
vp run --workspace-root --no-cache fix
vp run --workspace-root --cache test
```

**App.** Source host for iteration; built preview for release behavior. Choose a free port; requested remote exposure follows Browser.

```bash
HOST=127.0.0.1 vp -C apps/portfolio dev --host 127.0.0.1 --port <port> --strictPort
HOST=127.0.0.1 PORT=<port> vp run --filter @deslop/portfolio preview
```

**Components.** `vp run --workspace-root shadcn list @shadcn`; inspect with `shadcn view/docs`, add with `vp run --workspace-root shadcn add <component>`. List existing shared components before adding one.

## Install personal configuration

**Ownership.** Apply changed personal sources from this repository; preserve authentication, sessions and unrelated entries. Delete only named owned configs/roles/skills, then install current files. Native discovery invokes skills; these paths are installation targets, not manual invocation instructions. Public skill copies remain repository-only and versioned.

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
  rm -rf "$TARGET/skills/"{environment,maintenance,workflow,workflow-main,workflow-research,workflow-implementation,workflow-test,workflow-review,workflow-browser,workflow-maintenance,engineering,design,testing}
  mkdir -p "$TARGET/skills"
done
cp -R .claude/skills/{workflow,environment,maintenance} "$CLAUDE_TARGET/skills/"
for SKILL in workflow environment maintenance; do
  ln -s "$CLAUDE_TARGET/skills/$SKILL" "$CODEX_TARGET/skills/$SKILL"
done
```

**Verify.** Compare installed files/aliases, auth/unrelated preservation. Fresh sessions load changes; no provider restart.
