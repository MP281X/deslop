# Research

**Depth.** Answer the question from code, logs, named threads or primary documentation, and look for the counterexample that would decide it. Read dependencies in a cloned checkout, never in `node_modules`. When you count something, define and list the members. Stop when the question is answered.

**Return.** The answer, the sources that decide it and the facts still open. Videos and social posts go through the media skill.

## Source checkouts

Clone the official repository at the version the manifest or lockfile consumes, or reuse a matching vendored or shared checkout; check its remote and commit before citing it. Shared checkouts are read-only, and reading never needs an install or build.

```bash
git clone --depth 1 --branch <version-tag-or-required-branch> <official-repository-url> "$HOME/.deslop/repos/<repository>-<version>"
```

## Local transcript recovery

Prefer T3's thread tools. Otherwise set `T3_DB` to the verified live database from environment and find the named thread's native sessions:

```bash
sqlite3 -readonly -header -column "$T3_DB" "SELECT provider_thread_id, provider, status, json_extract(payload_json, '$.nativeThreadRef.nativeId') AS session_id, updated_at FROM orchestration_v2_projection_provider_threads WHERE thread_id = '<thread id>' ORDER BY updated_at DESC;"
S='<selected native session id>'
: "${S:?No native session selected}"
find "$HOME/.codex/sessions" "$HOME/.claude/projects" -type f -name "*$S.jsonl"
```

Pick the session that covers the run under investigation; the latest one may not include stopped or replaced runs, and stale legacy projections are no substitute. Claude subagents sit in `<session>/subagents/`. A Codex child's first `session_meta` record names its parent provider session in `payload.parent_thread_id`; messages forked from the parent are not new work. A `compacted` record marks a manual compaction, so recent activity starts after the last one.
