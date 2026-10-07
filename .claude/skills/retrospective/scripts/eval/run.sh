#!/usr/bin/env bash
# Run one headless eval session on a fresh copy of the snapshot.
# Usage: run.sh <variant> <scenario> <rep>
#   variant: a folder under $EVAL with system.md, or "codex" for Codex as the primary
#   scenario: a file $EVAL/<scenario>.txt
# Layout: $EVAL/snapshot is a git repository at the target's default branch;
#         results land in $EVAL/runs/<variant>-<scenario>-<rep>.*
# Run variants in parallel: printf '%s\n' "old e1 1" "new e1 1" | xargs -P 8 -n 3 run.sh
set -uo pipefail
EVAL=${EVAL:-/tmp/retro/eval}
variant=$1
scenario=$2
rep=$3
name=$variant-$scenario-$rep
work=/tmp/retro/work/$name
note='

---
Eval harness note: you run headless, outside T3. There is no question card, no html_render tool and no delegate_task tool. Where you would ask a question card, write a fenced block labeled CARD. Where you would call html_render, write a fenced block labeled RENDER. Stop where you would wait for the user. Work only inside the current directory, start no services and install nothing.'
prompt="$(cat "$EVAL/$scenario.txt")$note"
rm -rf "$work"
mkdir -p "$(dirname "$work")" "$EVAL/runs"
cp -r "$EVAL/snapshot" "$work"
cd "$work" || exit 2
start=$(date +%s)
if [ "$variant" = codex ]; then
	timeout 1500 codex exec --cd "$work" --skip-git-repo-check --ephemeral --dangerously-bypass-approvals-and-sandbox \
		-m gpt-6.1-sol -c model_reasoning_effort=high --json "$prompt" >"$EVAL/runs/$name.codex.jsonl" 2>"$EVAL/runs/$name.err"
else
	timeout 1500 claude -p "$prompt" --system-prompt "$(cat "$EVAL/$variant/system.md")" --disable-slash-commands \
		--model claude-opus-5-5 --effort high --disallowedTools AskUserQuestion --dangerously-skip-permissions \
		--output-format stream-json --verbose >"$EVAL/runs/$name.jsonl" 2>"$EVAL/runs/$name.err"
fi
status=$?
echo $(($(date +%s) - start)) >"$EVAL/runs/$name.secs"
git add -A >/dev/null 2>&1
git diff --cached --stat | tail -1 >"$EVAL/runs/$name.diffstat"
git diff --cached --name-only >"$EVAL/runs/$name.files"
echo "$name exit=$status"
