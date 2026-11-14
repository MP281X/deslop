#!/usr/bin/env bash
# Shared Claude/Codex Stop hook. JSON parsing keeps whitespace and tool-result text
# from changing turn boundaries. No HTML number-tile heuristic: charts share that shape.
set -eu
exec python3 -c '
import json
import re
import sys

event = json.load(sys.stdin)
if event.get("stop_hook_active"):
    sys.exit(0)

def content_text(content):
    if isinstance(content, str):
        return content
    return "\n".join(part.get("text", "") for part in content if part.get("type") in ("text", "input_text", "output_text"))

user = ""
rendered = False
reply = event.get("last_assistant_message", "")
transcript = event.get("transcript_path", "")
if transcript:
    with open(transcript) as source:
        for line in source:
            entry = json.loads(line)
            kind = entry.get("type")
            payload = entry.get("payload", {})
            if kind == "event_msg" and payload.get("type") == "task_started":
                user, rendered = "", False
            if kind == "user" and not entry.get("isMeta"):
                content = entry.get("message", {}).get("content", [])
                if isinstance(content, str) or not any(part.get("type") == "tool_result" for part in content):
                    user, rendered = content_text(content), False
            if kind == "event_msg" and payload.get("type") == "user_message":
                user = payload.get("message", "")
            if kind == "response_item" and payload.get("type") == "message" and payload.get("role") == "user":
                user = content_text(payload.get("content", []))
            calls = []
            if kind == "assistant":
                calls = [part for part in entry.get("message", {}).get("content", []) if part.get("type") == "tool_use"]
            if kind == "response_item" and payload.get("type") in ("function_call", "custom_tool_call"):
                calls = [payload]
            for call in calls:
                name = call.get("name", "")
                if re.search(r"(?:^|__)html_render$", name):
                    rendered = True
                # Code-mode invokes deferred tools inside an exec call.
                code = call.get("input", call.get("arguments", ""))
                if isinstance(code, str) and re.search(r"\btools\.\w*html_render\s*\(", code):
                    rendered = True

def block(reason):
    print(json.dumps({"decision": "block", "reason": reason}))
    sys.exit(0)

lines = reply.splitlines()
visual = rendered
after = 0
fence = None
structured = rendered
plain = []
for line in lines:
    opening = re.match(r"^\s*(`{3,}|~{3,})(.*)$", line)
    if opening:
        if fence:
            if opening[1][0] == fence[0] and len(opening[1]) >= len(fence):
                if mermaid:
                    visual, after = True, 0
                fence = None
        else:
            fence = opening[1]
            mermaid = opening[2].strip() == "mermaid"
            structured = True
        continue
    if fence:
        if not mermaid and line.strip():
            after += 1
        continue
    if re.search(r"!\[[^\]]*\]\([^)]*\)|!\[[^\]]*\]\[[^\]]*\]|<img\b", line):
        visual, structured, after = True, True, 0
        continue
    if line.strip():
        after += 1
        plain.append(line)

if visual and after > 2:
    block("Delete text after the visual; keep at most two lines for a link, caveat or decision owed.")

status = re.search(r"\b(?:still (?:waiting|running)|are in|next pass|reports back)\b|\bI(?:\x27|’)ll\b[^\n]*\bwhen\b", reply, re.I)
pr = re.search(r"https://[^\s)]+/(?:pull/\d+|-/merge_requests/\d+)", reply)
if user.startswith("Delegated task") and reply.strip() and (status or not (visual or pr)):
    block("The delegate wakeup is not the answer; finish the work or end this turn with no text.")

# A delimiter row identifies a real GFM table, not prose containing a pipe.
def cells(line):
    return [cell.strip() for cell in re.split(r"(?<!\\)\|", line.strip().strip("|"))]

index = 1
while index < len(plain):
    row = cells(plain[index])
    if "|" in plain[index] and all(re.fullmatch(r":?-{3,}:?", cell) for cell in row):
        structured = True
        values = cells(plain[index - 1])
        index += 1
        while index < len(plain) and "|" in plain[index]:
            values.extend(cells(plain[index]))
            index += 1
        if sum(len(value.split()) for value in values) > 8 * len(values):
            block("Replace the sentence table with a diagram, worked example or short value cells averaging at most eight words.")
    else:
        index += 1

if not structured and len(plain) > 12:
    block("Replace the prose wall with a table, diagram, image, code example or rendered page; keep prose to twelve lines.")
'
