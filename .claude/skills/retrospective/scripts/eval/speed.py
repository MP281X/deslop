#!/usr/bin/env python3
"""Compare headless Claude eval runs: time, steps, batching, reads and tokens.

Usage: speed.py [runs directory, default /tmp/retro/eval/runs]
"""
import collections
import glob
import json
import os
import re
import sys

runs = sys.argv[1] if len(sys.argv) > 1 else "/tmp/retro/eval/runs"
READER = re.compile(r"(?:cat|sed -n \S+|head(?: -n \d+)?)\s+([\w./-]+\.\w+)")
SLICE = re.compile(r"sed -n '?[\d,]+p|\bhead -n? ?\d+ [\w./]|\btail -n? ?\d+ [\w./]")

print("run secs steps calls single% rereads slices whole_reads files_changed tokens_M")
for path in sorted(glob.glob(f"{runs}/*.jsonl")):
    if path.endswith(".codex.jsonl"):
        continue
    name = os.path.basename(path)[: -len(".jsonl")]
    records = [json.loads(line) for line in open(path) if line.startswith("{")]
    steps, contexts, reads = collections.OrderedDict(), {}, collections.Counter()
    slices = whole = 0
    for record in records:
        if record.get("type") != "assistant":
            continue
        message = record["message"]
        usage = message.get("usage") or {}
        if usage:
            contexts[message["id"]] = (
                usage.get("input_tokens", 0) + usage.get("cache_read_input_tokens", 0) + usage.get("cache_creation_input_tokens", 0)
            )
        for block in message.get("content", []):
            if block.get("type") != "tool_use":
                continue
            steps[message["id"]] = steps.get(message["id"], 0) + 1
            given = block.get("input", {})
            if block["name"] == "Read":
                reads[given.get("file_path", "")] += 1
                if given.get("offset") or given.get("limit"):
                    slices += 1
                else:
                    whole += 1
            elif block["name"] == "Bash":
                command = given.get("command", "")
                for file in READER.findall(command):
                    reads[file] += 1
                slices += len(SLICE.findall(command))
    result = [r for r in records if r.get("type") == "result"]
    secs = round(result[-1]["duration_ms"] / 1000) if result else "NA"
    counts = list(steps.values())
    stat = open(path[: -len(".jsonl")] + ".diffstat").read() if os.path.exists(path[: -len(".jsonl")] + ".diffstat") else ""
    changed = re.search(r"(\d+) files? changed", stat)
    print(
        name,
        secs,
        len(counts),
        sum(counts),
        sum(1 for n in counts if n == 1) * 100 // max(len(counts), 1),
        sum(n - 1 for n in reads.values() if n > 1),
        slices,
        whole,
        changed.group(1) if changed else 0,
        round(sum(contexts.values()) / 1e6, 1),
    )
