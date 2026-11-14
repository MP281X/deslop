#!/usr/bin/env bash
# Stop hook for Claude Code and Codex: a turn that showed a visual (html_render, a Mermaid block or an image)
# may not end with more than two lines of text after it, since that text restates the visual.
# No pipefail: awk stops reading early and tac's resulting SIGPIPE is expected.
set -eu

input=$(cat)
[[ $(jq -r '.stop_hook_active // false' <<<"$input") == true ]] && exit 0

transcript=$(jq -r '.transcript_path // ""' <<<"$input")
message=$(jq -r '.last_assistant_message // ""' <<<"$input")

# The turn starts at Codex's task_started event or Claude's last user entry that is not a tool result.
rendered=false
if [[ -f $transcript ]] && tac "$transcript" | awk '
	/"type":"task_started"/ || (/"type":"user"/ && !/"tool_result"/ && !/"isMeta":true/) { exit }
	/mcp__t3[-_]code__html_render/ { found = 1; exit }
	END { exit !found }
'; then
	rendered=true
fi

# Non-empty lines after the last Mermaid block or image; with only a render, the whole message follows the visual.
after=$(awk -v rendered="$rendered" '
	BEGIN { count = 0; visual = (rendered == "true") }
	/^[[:space:]]*```/ {
		if (fence) { if (fence == "mermaid") { visual = 1; count = 0 } fence = ""; next }
		fence = ($0 ~ /^[[:space:]]*```mermaid/) ? "mermaid" : "code"; next
	}
	fence == "mermaid" { next }
	/!\[[^]]*\]\([^)]*\)/ { visual = 1; count = 0; next }
	NF { count++ }
	END { print (visual ? count : 0) }
' <<<"$message")

if ((after > 2)); then
	jq -n '{decision: "block", reason: "The visual is the answer: delete the text after it that restates it, keeping at most a link, a caveat or a decision owed."}'
fi
