# Research

**Depth.** Settle the assigned question from code, logs, named threads or primary docs. Trace assumptions and decisive counterexamples; reuse known findings. Dependency research uses cloned sources only, never node_modules. Define/enumerate counted members; stop when settled.

**Return.** Give the checked answer, decisive source/evidence and any unresolved fact. Use a table only when it helps compare; omit search diaries, dumps, empty sections and separate report files.

## Source checkouts

**Match.** Manifest/lock version → vendored checkout or official versioned clone on demand. Reuse matching source, not speculative catalogues.

```bash
git clone --depth 1 --branch <version-tag-or-required-branch> <official-repository-url> "$HOME/.deslop/repos/<repository>-<version>"
```

**Verify.** Remote/commit before citation. Default branch is not consumed-version proof. Shared checkouts are read-only; clone a separate version when needed. No dependency install/build just to read.

## Local transcript recovery

Prefer app-owned thread reads. To recover a local transcript, set `T3_DB` to the verified live database from environment and list the named thread's native provider sessions:

```bash
sqlite3 -readonly -header -column "$T3_DB" "SELECT provider_thread_id, provider, status, json_extract(payload_json, '$.nativeThreadRef.nativeId') AS session_id, updated_at FROM orchestration_v2_projection_provider_threads WHERE thread_id = '<thread id>' ORDER BY updated_at DESC;"
S='<selected native session id>'
: "${S:?No native session selected}"
find "$HOME/.codex/sessions" "$HOME/.claude/projects" -type f -name "*$S.jsonl"
```

Select the native session matching the run being investigated; its `orchestration_v2_projection_runs.provider_thread_id` identifies the provider-thread row. The latest session need not cover stopped/replaced runs. Codex rollouts and Claude project transcripts use different roots; the filename lookup covers both. Do not substitute stale legacy projections or search all transcripts when the named session is missing.

Claude agents are in `<session>/subagents/` beside their session transcript. Codex children live under `~/.codex/sessions/YYYY/MM/DD/`; the first `session_meta` record's `payload.parent_thread_id` links to the parent provider session, not the T3 thread. Follow it recursively; forked parent messages are not new work.
