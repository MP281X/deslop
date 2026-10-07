#!/usr/bin/env python3
"""Split Codex sessions into model time, tool time and answer size.

Usage: codex_sessions.py <session.jsonl> [...]
Example: codex_sessions.py ~/.codex/sessions/2026/10/07/*.jsonl
"""
import datetime
import json
import os
import sys


def when(stamp):
    return datetime.datetime.fromisoformat(stamp.replace("Z", "+00:00"))


print("minutes total  model  tools  calls  output_tokens  effort  session")
for path in sys.argv[1:]:
    records = [json.loads(line) for line in open(path) if line.startswith("{")]
    stamps = [when(r["timestamp"]) for r in records if r.get("timestamp")]
    if len(stamps) < 2:
        continue
    model = tools = 0.0
    calls, started, last_output, effort, output_tokens = 0, {}, None, None, 0
    for record in records:
        payload = record.get("payload") or {}
        kind = payload.get("type")
        if record.get("type") == "turn_context":
            effort = payload.get("effort")
        elif record.get("type") == "response_item" and kind in ("function_call", "custom_tool_call"):
            calls += 1
            stamp = when(record["timestamp"])
            if last_output:
                model += (stamp - last_output).total_seconds()
            started[payload.get("call_id")] = stamp
        elif record.get("type") == "response_item" and kind in ("function_call_output", "custom_tool_call_output"):
            stamp = when(record["timestamp"])
            if payload.get("call_id") in started:
                tools += (stamp - started[payload["call_id"]]).total_seconds()
            last_output = stamp
        elif record.get("type") == "event_msg" and kind == "token_count" and payload.get("info"):
            output_tokens = payload["info"].get("total_token_usage", {}).get("output_tokens", 0)
    total = (stamps[-1] - stamps[0]).total_seconds()
    print(f"{total / 60:13.1f}  {model / 60:5.1f}  {tools / 60:5.1f}  {calls:5d}  {output_tokens:13d}  {effort}  {os.path.basename(path)[-41:]}")
