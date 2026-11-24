#!/usr/bin/env bash
# Claude and Codex read the same flow from two files, so everything from `# Work` down must match.
set -eo pipefail
diff <(sed -n '/^# Work/,$p' .claude/agents/pair.md) <(sed -n '/^# Work/,$p' .codex/instructions.md)
