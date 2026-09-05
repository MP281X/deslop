#!/usr/bin/env bash

set -euo pipefail

test_directory=$(mktemp -d)
trap 'rm -rf -- "$test_directory"' EXIT

fail() {
	printf 'FAIL: %s\n' "$1" >&2
	exit 1
}

assert_file() {
	[[ -f $1 ]] || fail "expected file: $1"
}

assert_content() {
	[[ $(cat -- "$1") == "$2" ]] || fail "unexpected content: $1"
}

fixture=$test_directory/repository/workflow
target_home=$test_directory/codex-home
mkdir -p -- "$fixture/codex/agents" "$fixture/skills/engineering/references" "$fixture/skills/workflow" "$target_home/agents" "$target_home/skills/unrelated"
cp -- "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)/install.sh" "$fixture/install.sh"
printf 'config-v1\n' > "$fixture/codex/config.toml"
printf 'agent-v1\n' > "$fixture/codex/agents/primary.toml"
printf 'instructions-v1\n' > "$fixture/AGENTS.md"
printf 'engineering-v1\n' > "$fixture/skills/engineering/SKILL.md"
printf 'obsolete\n' > "$fixture/skills/engineering/references/obsolete.md"
printf 'workflow-v1\n' > "$fixture/skills/workflow/SKILL.md"
printf 'auth\n' > "$target_home/auth.json"
printf 'unrelated-agent\n' > "$target_home/agents/other.toml"
printf 'unrelated-skill\n' > "$target_home/skills/unrelated/SKILL.md"

bash "$fixture/install.sh" "$target_home" >/dev/null
assert_content "$target_home/config.toml" config-v1
assert_content "$target_home/agents/deslop/primary.toml" agent-v1
assert_content "$target_home/skills/engineering/references/obsolete.md" obsolete
assert_content "$target_home/auth.json" auth
assert_content "$target_home/agents/other.toml" unrelated-agent
assert_content "$target_home/skills/unrelated/SKILL.md" unrelated-skill

bash "$fixture/install.sh" "$target_home" >/dev/null
backup_count=$(find "$target_home/.deslop-backups" -mindepth 1 -maxdepth 1 -type d | wc -l)
(( backup_count == 2 )) || fail 'repeat install did not create a second backup'

printf 'config-v2\n' > "$fixture/codex/config.toml"
printf 'engineering-v2\n' > "$fixture/skills/engineering/SKILL.md"
rm -- "$fixture/skills/engineering/references/obsolete.md"
bash "$fixture/install.sh" "$target_home" >/dev/null
assert_content "$target_home/config.toml" config-v2
assert_content "$target_home/skills/engineering/SKILL.md" engineering-v2
[[ ! -e $target_home/skills/engineering/references/obsolete.md ]] || fail 'obsolete owned file survived replacement'
rg -l -F 'config-v1' "$target_home/.deslop-backups"/*/config.toml >/dev/null || fail 'previous config was not backed up'
find "$target_home/.deslop-backups" -path '*/skills/engineering/references/obsolete.md' -type f | rg . >/dev/null || fail 'removed owned file was not backed up'
assert_content "$target_home/auth.json" auth
assert_content "$target_home/agents/other.toml" unrelated-agent

unsafe_home=$test_directory/unsafe-home
outside=$test_directory/outside
mkdir -p -- "$unsafe_home" "$outside"
ln -s -- "$outside" "$unsafe_home/agents"
if bash "$fixture/install.sh" "$unsafe_home" >/dev/null 2>&1; then
	fail 'installer accepted a symlinked managed parent'
fi
[[ -z $(find "$outside" -mindepth 1 -print -quit) ]] || fail 'installer wrote through a symlinked managed parent'

assert_file "$target_home/AGENTS.md"
printf 'PASS\n'
