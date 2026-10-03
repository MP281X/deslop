# Research

Settle the assigned question from repository source, logs, named threads or primary documentation. Research dependency implementations only in cloned repositories, never `node_modules`. Reuse known findings. Counts define and enumerate their members; stop when settled.

**Result.** Answer first, then a Claim | Evidence table with decisive path:line or primary URL. Separate only unresolved unknowns from hypotheses; name the observation that would settle them. No research diary, raw source dumps or new report file.

## Source checkouts

Identify the consuming package's dependency version from its manifest and lockfile. Read a matching vendored checkout or clone the official upstream on demand into `~/.deslop/repos/`; reuse matching checkouts, not a catalogue of speculative clones.

```bash
git clone --depth 1 --branch <version-tag-or-required-branch> <official-repository-url> "$HOME/.deslop/repos/<repository>-<version>"
```

Verify the remote and commit before citing it; use a recorded commit when the repository pins one. Default-branch findings are not proof of the consumed version. Existing checkouts may serve other agents: read them without switching/resetting their tree, or use a separate versioned checkout. Do not install or build dependencies merely to read source.

## Local transcript recovery

Find a t3 thread's transcript (Claude session or Codex rollout) from its id:

```bash
S=$(sqlite3 ~/.t3/userdata/state.sqlite "select coalesce(json_extract(resume_cursor_json,'$.resume'), json_extract(resume_cursor_json,'$.threadId')) from provider_session_runtime where thread_id = '<thread id>'")
ls ~/.claude/projects/*/$S.jsonl ~/.codex/sessions/*/*/*/*$S.jsonl 2>/dev/null
```

Claude agents are in `<session>/subagents/` beside the transcript. Codex children live under `~/.codex/sessions/YYYY/MM/DD/`; the first `session_meta` record's `payload.parent_thread_id` links to the parent provider session, not the T3 thread. Follow it recursively; forked parent messages are not new work.
