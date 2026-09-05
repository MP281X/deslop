#!/usr/bin/env bash

set -euo pipefail

if (( $# > 1 )); then
	printf 'usage: %s [codex-home]\n' "$0" >&2
	exit 2
fi

script_directory=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
codex_home=${1:-"${CODEX_HOME:-$HOME/.codex}"}

for source_path in \
	"$script_directory/codex/config.toml" \
	"$script_directory/codex/agents" \
	"$script_directory/AGENTS.md" \
	"$script_directory/skills/engineering" \
	"$script_directory/skills/workflow"; do
	if [[ ! -e $source_path ]]; then
		printf 'missing install source: %s\n' "$source_path" >&2
		exit 1
	fi
done

mkdir -p -- "$codex_home"
codex_home=$(cd -- "$codex_home" && pwd -P)

for parent in agents skills; do
	if [[ -L $codex_home/$parent ]]; then
		printf 'refusing to install through symlink: %s\n' "$codex_home/$parent" >&2
		exit 1
	fi
done

mkdir -p -- "$codex_home/agents" "$codex_home/skills" "$codex_home/.deslop-backups"
backup_directory=$(mktemp -d "$codex_home/.deslop-backups/$(date -u +%Y%m%dT%H%M%SZ).XXXXXX")
stage_directory=$(mktemp -d "$codex_home/.deslop-install.XXXXXX")
trap 'rm -rf -- "$stage_directory"' EXIT

owned_targets=(
	config.toml
	AGENTS.md
	agents/deslop
	skills/engineering
	skills/workflow
)

for relative_path in "${owned_targets[@]}"; do
	target=$codex_home/$relative_path
	if [[ -e $target || -L $target ]]; then
		mkdir -p -- "$backup_directory/$(dirname -- "$relative_path")"
		cp -a -- "$target" "$backup_directory/$relative_path"
	fi
done

mkdir -p -- "$stage_directory/agents" "$stage_directory/skills"
cp -a -- "$script_directory/codex/config.toml" "$stage_directory/config.toml"
cp -a -- "$script_directory/AGENTS.md" "$stage_directory/AGENTS.md"
cp -a -- "$script_directory/codex/agents" "$stage_directory/agents/deslop"
cp -a -- "$script_directory/skills/engineering" "$stage_directory/skills/engineering"
cp -a -- "$script_directory/skills/workflow" "$stage_directory/skills/workflow"

for relative_path in "${owned_targets[@]}"; do
	target=$codex_home/$relative_path
	rm -rf -- "$target"
	mv -- "$stage_directory/$relative_path" "$target"
done

printf 'Installed Deslop workflow in %s\n' "$codex_home"
printf 'Previous owned files, when present, are in %s\n' "$backup_directory"
