#!/usr/bin/env python3
"""Measure where a Claude Code transcript spent its steps and time.

Usage: transcript.py <session.jsonl> [...]
"""
import collections
import datetime
import json
import re
import statistics
import sys

READER = re.compile(r"(?:^|[;&|]\s*)(?:cat|sed -n [\d,]+p|head(?: -\d+| -n \d+)?|tail(?: -n \d+)?)\s+([\w./~-]+\.\w+)")
SLICE = re.compile(r"sed -n '?[\d,]+p|\bhead -n? ?\d+ [\w./]|\btail -n? ?\d+ [\w./]")
WAIT = re.compile(r"^\s*(sleep|until)\b|; sleep \d+|SECONDS")


def when(stamp):
    return datetime.datetime.fromisoformat(stamp.replace("Z", "+00:00"))


def text_of(content):
    if isinstance(content, str):
        return content
    return " ".join(part.get("text", "") for part in content if isinstance(part, dict))


def analyze(path):
    records = [json.loads(line) for line in open(path) if line.startswith("{")]
    calls, steps, contexts = {}, collections.OrderedDict(), {}
    for record in records:
        if record.get("type") == "assistant":
            message = record["message"]
            usage = message.get("usage") or {}
            if usage:
                contexts[message["id"]] = (
                    usage.get("input_tokens", 0)
                    + usage.get("cache_read_input_tokens", 0)
                    + usage.get("cache_creation_input_tokens", 0)
                )
            for block in message.get("content", []):
                if block.get("type") == "tool_use":
                    calls[block["id"]] = {"name": block["name"], "input": block.get("input", {}), "start": when(record["timestamp"])}
                    steps.setdefault(message["id"], []).append(block["id"])
        elif record.get("type") == "user" and isinstance(record["message"].get("content"), list):
            for block in record["message"]["content"]:
                if isinstance(block, dict) and block.get("type") == "tool_result" and block.get("tool_use_id") in calls:
                    call = calls[block["tool_use_id"]]
                    call["out"] = text_of(block.get("content"))
                    call["error"] = bool(block.get("is_error"))
                    call["secs"] = (when(record["timestamp"]) - call["start"]).total_seconds()

    time_by_tool, count_by_tool = collections.Counter(), collections.Counter()
    no_value, mergeable = collections.Counter(), collections.Counter()
    seen_files, seen_inputs = collections.Counter(), collections.Counter()
    slices = full_reads = 0
    for call in calls.values():
        name, out, command = call["name"], call.get("out", ""), call["input"].get("command", "")
        time_by_tool[name] += call.get("secs", 0)
        count_by_tool[name] += 1
        if name.endswith("t3_thread_wait") and ('"timedOut":true' in out or "interrupted" in out):
            no_value["wait that ended without a result"] += 1
        elif name.endswith("task_status") and '"status":"running"' in out:
            no_value["status check on a running child"] += 1
        elif call.get("error") or (name == "Bash" and re.search(r"Exit code [1-9]|command not found|No such file", out[:400])):
            no_value["failed call"] += 1
        if name == "Bash" and WAIT.search(command):
            mergeable["blind or polling wait"] += 1
        if name == "Read":
            files = [call["input"].get("file_path")]
            if call["input"].get("offset") or call["input"].get("limit"):
                slices += 1
            else:
                full_reads += 1
        else:
            files = READER.findall(command) if name == "Bash" else []
            slices += len(SLICE.findall(command)) if name == "Bash" else 0
        if files and all(seen_files[f] for f in files):
            mergeable["reread of a file already read"] += 1
        for f in files:
            seen_files[f] += 1
        key = json.dumps(call["input"], sort_keys=True)
        if seen_inputs[key] and not name.endswith(("t3_thread_wait", "task_status")):
            mergeable["exact duplicate call"] += 1
        seen_inputs[key] += 1

    run = 0
    for ids in steps.values():
        call = calls[ids[0]]
        lone_read = len(ids) == 1 and (
            call["name"] == "Read"
            or (call["name"] == "Bash" and re.match(r"\s*(cat|sed -n|head|grep|rg|find|ls|wc)\b", call["input"].get("command", "")))
        )
        if lone_read:
            run += 1
        else:
            mergeable["read that could join the step before"] += max(run - 1, 0)
            run = 0

    sizes = list(contexts.values())
    single = sum(1 for ids in steps.values() if len(ids) == 1)
    print(f"== {path}")
    print(f"steps {len(steps)}  calls {len(calls)}  single-call steps {single * 100 // max(len(steps), 1)}%")
    if sizes:
        print(f"context tokens: median {statistics.median(sizes):.0f}  max {max(sizes)}  summed {sum(sizes) / 1e6:.1f}M")
    print(f"reads: {full_reads} whole, {slices} slices")
    print("minutes by tool:")
    for name, secs in time_by_tool.most_common(8):
        print(f"  {secs / 60:6.1f}  {count_by_tool[name]:4d}x  {name}")
    print(f"no value: {sum(no_value.values())}")
    for kind, n in no_value.most_common():
        print(f"  {n:4d}  {kind}")
    print(f"mergeable or skippable: {sum(mergeable.values())}")
    for kind, n in mergeable.most_common():
        print(f"  {n:4d}  {kind}")


for transcript in sys.argv[1:]:
    analyze(transcript)
