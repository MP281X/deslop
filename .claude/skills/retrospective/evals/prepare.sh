#!/usr/bin/env bash
# Usage: [EVAL=<folder>] [HARNESS='Claude Codex'] prepare.sh <old ref> <new ref> <probe>[:<runs>] ...
# Builds both variants' homes, one folder per run and runs/manifest.tsv under /tmp/retro/<date>/eval,
# and adds the eval<Folder>ClaudeOld, ClaudeNew, CodexOld and CodexNew instances to T3's settings.
set -euo pipefail
E=$(cd "$(dirname "$0")" && pwd)
REPO=$(git -C "$E" rev-parse --show-toplevel)
EVAL=${EVAL:-eval}
OUT=/tmp/retro/$(date +%F)/$EVAL
TAG=${EVAL^}
old=$1 new=$2
shift 2
rm -rf "$OUT"
mkdir -p "$OUT/runs"

home() { # <variant> <ref>
	local v=$OUT/variants/$1 c=$OUT/homes/claude-$1 x=$OUT/homes/codex-$1
	mkdir -p "$v" "$c/agents" "$c/skills" "$x/rules" "$x/skills"
	git -C "$REPO" archive "$2" .claude .codex | tar -x -C "$v"
	jq '.agent = "eval-pair"' "$v/.claude/settings.json" > "$c/settings.json"
	sed 's/^name: pair$/name: eval-pair/' "$v/.claude/agents/pair.md" > "$c/agents/eval-pair.md"
	cp "$v/.codex/config.toml" "$v/.codex/instructions.md" "$x/"
	cp "$v/.codex/rules/deny.rules" "$x/rules/"
	sed -i "s|^model_instructions_file = .*|model_instructions_file = \"$x/instructions.md\"|" "$x/config.toml"
	printf '\n[projects."%s"]\ntrust_level = "trusted"\n' "$OUT/runs" >> "$x/config.toml"
	for s in software-factory explore environment engineering design testing; do
		cp -r "$v/.claude/skills/$s" "$c/skills/"
		cp -r "$v/.claude/skills/$s" "$x/skills/"
	done
	ln -s ~/.claude/.credentials.json "$c/.credentials.json"
	ln -s ~/.codex/auth.json "$x/auth.json"
}

stash_probe() { # <run dir> <probe dir>: a small repository with two stacked branches, its origin, captures and fakes
	local d=$1 s=$E/fixtures/stash-probe g=(-c user.name=probe -c user.email=probe@example.com)
	mkdir -p "$d/repo/src" "$d/repo/out" "$d/out"
	cp -r "$E/fakebin" "$d/"
	cd "$d/repo"
	git init -q -b main
	cp "$s/package.json" "$s/README.md" .
	cp "$s/notes.ts" src/
	git add -A && git "${g[@]}" commit -qm 'stash-probe: notes'
	git switch -qc t3/export
	cp "$s/export.ts" "$s/export.test.ts" src/
	git add -A && git "${g[@]}" commit -qm 'stash: export every note as a markdown file'
	git switch -qc t3/export-2-cli
	cp "$s/cli.ts" src/
	git add -A && git "${g[@]}" commit -qm 'stash: export from the CLI into a folder you pick'
	git switch -q t3/export
	git clone -q --bare . "$d/origin.git"
	git remote add origin "$d/origin.git"
	if [ -f "$2/gh-state.json" ]; then
		cp "$2/gh-state.json" "$d/"
		jq -e '.prs[] | select(.headRefName == "t3/export-2-cli")' "$2/gh-state.json" > /dev/null || {
			git branch -qD t3/export-2-cli
			git -C "$d/origin.git" branch -qD t3/export-2-cli
		}
	fi
	git fetch -q origin
	printf 'out/\n' > .git/info/exclude
	# Captures of the real CLI run and the files it wrote
	local font=DejaVu-Sans-Mono vault=$d/vault cli
	git show t3/export-2-cli:src/cli.ts > src/cli.ts
	cli=$(cd "$d" && node repo/src/cli.ts vault)
	rm src/cli.ts
	magick -size 1280x800 xc:'#0b0b0c' -font $font -pointsize 28 -fill '#e5e5e5' \
		-annotate +60+90 '$ stash export vault' -fill '#9ae6b4' -annotate +60+140 "$cli" out/cli-prints-count.png
	magick -size 1280x800 xc:'#0b0b0c' -font $font -pointsize 28 -fill '#e5e5e5' \
		-annotate +60+90 '$ ls vault' -annotate +60+140 "$(ls "$vault" | tr '\n' ' ')" -annotate +60+220 '$ cat vault/a1.md' \
		-annotate +60+270 "$(cat "$vault/a1.md")" "$d/out/files.png"
	ffmpeg -loglevel error -y -loop 1 -t 3 -i out/cli-prints-count.png -loop 1 -t 4 -i "$d/out/files.png" \
		-filter_complex '[0][1]concat=n=2:v=1:a=0,format=yuv420p' out/export-writes-files.mp4
	rm "$d/out/files.png"
	cd - > /dev/null
}

deslop_snapshot() { # <run dir> <variant>: the repository at <old ref> with only the variant's shared skills
	local d=$1 g=(-c user.name=probe -c user.email=probe@example.com)
	mkdir -p "$d/repo" "$d/out"
	git -C "$REPO" archive "$old" | tar -x -C "$d/repo"
	rm -rf "$d/repo/.claude" "$d/repo/.codex"
	for root in .claude .codex; do
		mkdir -p "$d/repo/$root/skills"
		for s in engineering design testing; do cp -r "$OUT/variants/$2/.claude/skills/$s" "$d/repo/$root/skills/"; done
	done
	git -C "$d/repo" init -q -b main
	git -C "$d/repo" add -A
	git -C "$d/repo" "${g[@]}" commit -qm snapshot
}

home old "$old"
home new "$new"
for spec in "$@"; do
	probe=${spec%%:*}
	runs=${spec#*:}
	[ "$runs" = "$spec" ] && runs=6
	p=$E/probes/$probe
	for harness in ${HARNESS:-Claude Codex}; do for v in old new; do
		for i in $(seq "$runs"); do
			id=$probe-${harness,,}-$v-$i
			d=$OUT/runs/$id
			case $probe in
				ready | later | jira) stash_probe "$d" "$p" ;;
				*) deslop_snapshot "$d" "$v" ;;
			esac
			sed "s|RUNDIR|$d|g" "$p/task.md" > "$d/task.md"
			printf '%s\teval%s%s%s\t%s\n' "$id" "$TAG" "$harness" "${v^}" "$d/task.md" >> "$OUT/runs/manifest.tsv"
		done
	done; done
done

cp ~/.t3/userdata/settings.json "$OUT/settings.before.json"
jq --arg O "$OUT" --arg T "$TAG" 'def c(v): {driver: "claudeAgent", enabled: true, config: {binaryPath: "claude", homePath: ($O + "/homes/claude-" + v), launchArgs: ("--system-prompt-snapshot off --agent eval-pair --settings " + $O + "/homes/claude-" + v + "/settings.json")}};
	def x(v): {driver: "codex", enabled: true, config: {binaryPath: "codex", homePath: ($O + "/homes/codex-" + v), launchArgs: ("-c model_instructions_file=" + $O + "/homes/codex-" + v + "/instructions.md")}};
	.providerInstances += {("eval" + $T + "ClaudeOld"): c("old"), ("eval" + $T + "ClaudeNew"): c("new"), ("eval" + $T + "CodexOld"): x("old"), ("eval" + $T + "CodexNew"): x("new")}' "$OUT/settings.before.json" > "$OUT/settings.eval.json"
cp "$OUT/settings.eval.json" ~/.t3/userdata/settings.json
wc -l < "$OUT/runs/manifest.tsv"
