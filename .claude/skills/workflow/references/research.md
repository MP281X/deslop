# Research

**Depth.** Answer the assigned question from code, logs, named threads or primary documentation. Trace the assumptions and look for the counterexample that would decide the question; reuse findings that already exist. Research a dependency in a cloned source checkout, never in `node_modules`. When you count something, define what counts and list the members. Stop when the question is answered.

**Return.** Answer the assigned question with the sources that decide it and the facts that remain open. For a video or social post, use the media skill.

## Source checkouts

**Match.** Read the version from the manifest or lockfile, then use the vendored checkout or clone the official repository at that version when you need it. Reuse a checkout that matches; do not build a catalogue of sources in advance.

```bash
git clone --depth 1 --branch <version-tag-or-required-branch> <official-repository-url> "$HOME/.deslop/repos/<repository>-<version>"
```

**Verify.** Check the remote and commit before you cite a checkout. The default branch does not prove which version a project consumes. Treat shared checkouts as read-only and clone a separate version when you need one. Do not install or build a dependency only to read it.

## Local transcript recovery

Prefer T3's own thread tools. To recover a local transcript, set `T3_DB` to the live database that environment describes, after verifying it, and list the named thread's native provider sessions:

```bash
sqlite3 -readonly -header -column "$T3_DB" "SELECT provider_thread_id, provider, status, json_extract(payload_json, '$.nativeThreadRef.nativeId') AS session_id, updated_at FROM orchestration_v2_projection_provider_threads WHERE thread_id = '<thread id>' ORDER BY updated_at DESC;"
S='<selected native session id>'
: "${S:?No native session selected}"
find "$HOME/.codex/sessions" "$HOME/.claude/projects" -type f -name "*$S.jsonl"
```

Select the native session that matches the run under investigation; its `orchestration_v2_projection_runs.provider_thread_id` identifies the provider thread. The latest session may not cover runs that were stopped or replaced. Codex rollouts and Claude project transcripts live under different roots, and the filename lookup covers both. When the named session is missing, do not substitute stale legacy projections or search every transcript.

Claude subagents are in `<session>/subagents/` beside their session transcript. Codex children live under `~/.codex/sessions/YYYY/MM/DD/`; the first `session_meta` record's `payload.parent_thread_id` links to the parent provider session, not to the T3 thread. Follow that link recursively; messages forked from the parent are not new work. A manual compaction appears as a `compacted` record; read the work after the last one when the user asks about recent activity.
