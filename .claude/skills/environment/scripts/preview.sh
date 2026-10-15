#!/usr/bin/env bash
# One preview per worktree: a systemd user unit shared on the tailnet over HTTPS.
#   preview.sh start <command...>  start or restart the preview, then print its HTTPS URL
#   preview.sh stop [cleanup...]   remove its Tailscale mappings, stop its units, run cleanup
#   preview.sh settle [cleanup...] stop, unless an open thread other than a subagent uses the worktree
# T3 runs scripts in the worktree and sets T3CODE_WORKTREE_PATH.
set -euo pipefail
shopt -s inherit_errexit
export PATH="$HOME/.local/bin:$HOME/.vite-plus/bin:$PATH"

worktree=${T3CODE_WORKTREE_PATH:-$(git rev-parse --show-toplevel)}
host=$(tailscale status --json | jq -r '.Self.DNSName | rtrimstr(".")')

units() {
	local list unit directory
	list=$(systemctl --user list-units --all --type=service --plain --no-legend)
	for unit in $(echo "$list" | awk '{print $1}'); do
		directory=$(systemctl --user show --property=WorkingDirectory --value "$unit")
		[ "$directory" != "$worktree" ] || echo "$unit"
	done
}

listening() {
	ss -ltnH | awk -v address="$1" 'substr($4, length($4) - length(address) + 1) == address {found = 1} END {exit !found}'
}

stop() {
	local serve owned unit cgroup pids listeners ports mappings mode port
	serve=$(sudo tailscale serve status --json)
	owned=$(units)
	for unit in $owned; do
		cgroup=$(systemctl --user show --property=ControlGroup --value "$unit")
		if [ -n "$cgroup" ]; then
			pids=$(find "/sys/fs/cgroup$cgroup" -name cgroup.procs -exec cat {} + | paste -sd, -)
			listeners=$(ss -ltnpH)
			ports=$(echo "$listeners" | awk -v pids=",$pids," '{
				n = split($4, a, ":"); rest = $0
				while (match(rest, /pid=[0-9]+/)) {
					if (index(pids, "," substr(rest, RSTART + 4, RLENGTH - 4) ",")) print a[n]
					rest = substr(rest, RSTART + RLENGTH)
				}
			}' | sort -u | jq -R 'tonumber' | jq -s -c .)
			mappings=$(echo "$serve" | jq -r --argjson ports "$ports" '
				(.AllowFunnel // {}) as $funnel
				| .Web // {} | to_entries[]
				| select([.value.Handlers[]?.Proxy // "" | capture("^[a-z]+://[^/]+:(?<p>[0-9]+)") | .p | tonumber] | any(IN($ports[])))
				| "\(if $funnel[.key] then "funnel" else "serve" end) \(.key | split(":") | last)"')
			while read -r mode port; do
				[ -n "$mode" ] || continue
				sudo tailscale "$mode" --https="$port" off
				echo "removed tailscale $mode on port $port"
			done <<<"$mappings"
			systemctl --user stop "$unit"
			echo "stopped $unit"
		fi
		systemctl --user reset-failed "$unit" 2>/dev/null || true
	done
	if [ $# -gt 0 ]; then "$@"; fi
}

start() {
	local owned unit port invocation line deadline
	owned=$(units)
	unit=$(echo "$owned" | sed -n 1p)
	port=""
	if [ -n "$unit" ] && systemctl --user is-active -q "$unit"; then
		port=$(systemctl --user show --property=Environment --value "$unit" | tr ' ' '\n' | sed -n 's/^PORT=//p')
	fi
	if [ -n "$port" ]; then
		systemctl --user restart "$unit"
	else
		# A unit without PORT predates this script: replace it.
		[ -z "$unit" ] || systemctl --user stop "$unit" 2>/dev/null || true
		[ -z "$unit" ] || systemctl --user reset-failed "$unit" 2>/dev/null || true
		common=$(git rev-parse --path-format=absolute --git-common-dir)
		unit="$(basename "$(dirname "$common")")-preview-$(basename "$worktree").service"
		# A port derived from the path keeps the URL stable across restarts.
		port=$((20000 + 0x$(printf '%s' "$worktree" | sha256sum | cut -c1-4) % 10000))
		while listening ":$port"; do port=$((port + 1)); done
		systemd-run --user --quiet --unit="$unit" --working-directory="$worktree" --property=KillSignal=SIGINT \
			--setenv=PATH="$PATH" --setenv=HOST=127.0.0.1 --setenv=PORT="$port" --setenv=DUAL_PREVIEW_HOST="$host" "$@"
	fi
	# Ready when the command prints "Preview ready: <url>" (Dual) or listens on PORT (deslop).
	invocation=$(systemctl --user show --property=InvocationID --value "$unit")
	deadline=$(($(date +%s) + 900))
	while :; do
		systemctl --user is-failed -q "$unit" && { journalctl --user _SYSTEMD_INVOCATION_ID="$invocation" -o cat | tail -30; exit 1; }
		line=$(journalctl --user _SYSTEMD_INVOCATION_ID="$invocation" -o cat | grep -oE 'Preview ready: [^ ]+' | sed -n 1p || true)
		if [ -n "$line" ]; then port=${line##*:}; break; fi
		listening "127.0.0.1:$port" && break
		[ "$(date +%s)" -lt "$deadline" ] || { echo "$unit is not ready after 15 minutes" >&2; exit 1; }
		sleep 2
	done
	sudo tailscale serve --bg --https="$port" "http://127.0.0.1:$port" >/dev/null
	echo "https://$host:$port"
}

command=${1:?usage: preview.sh start <command...> or stop or settle [cleanup...]}
shift
case $command in
	start) start "$@" ;;
	stop) stop "$@" ;;
	settle)
		quoted=${worktree//\'/\'\'}
		open=$(sqlite3 -readonly ~/.t3/userdata/statev2.sqlite "
		  SELECT count(*) FROM orchestration_v2_projection_threads
		  WHERE deleted_at IS NULL AND archived_at IS NULL
		    AND json_extract(payload_json, '$.worktreePath') = '$quoted'
		    AND json_extract(payload_json, '$.lineage.relationshipToParent') IS NOT 'subagent'
		    AND json_extract(payload_json, '$.settledOverride') IS NOT 'settled'")
		if [ "$open" -gt 0 ]; then
			echo "open threads in $worktree: $open; the preview stays"
		else
			stop "$@"
		fi
		;;
	*) echo "unknown command: $command" >&2; exit 2 ;;
esac
