#!/usr/bin/env bash
# Assemble a headless system prompt: the pair prompt, then the skills a primary loads.
# Usage: build-prompt.sh <pair.md> <workflow SKILL.md> <output system.md>
set -euo pipefail
pair=$1
workflow=$2
output=$3
skills=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)/.claude/skills
strip() { awk 'BEGIN{f=0} NR==1&&/^---$/{f=1;next} f&&/^---$/{f=0;next} !f' "$1"; }
mkdir -p "$(dirname "$output")"
{
	strip "$pair"
	printf '\n\n# Loaded skill: workflow\n\n'
	strip "$workflow"
	for skill in design engineering; do
		printf '\n\n# Loaded skill: %s\n\n' "$skill"
		strip "$skills/$skill/SKILL.md"
	done
} >"$output"
