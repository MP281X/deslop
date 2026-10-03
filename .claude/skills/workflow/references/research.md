# Research

**Depth.** Settle the assigned question from code, logs, named threads or primary docs. Trace assumptions and decisive counterexamples; reuse known findings. Dependency research uses cloned sources only, never node_modules. Define/enumerate counted members; stop when settled.

## Result

- **Answer.** Checked conclusion first, not the search process.
- **Evidence.** Claim | Observation | Source (path:line or primary URL).
- **Unknowns.** Unresolved facts separate from hypotheses; give the decisive next observation. Omit empty sections, diaries, dumps and report files.

## Source checkouts

**Match.** Manifest/lock version → vendored checkout or official versioned clone on demand. Reuse matching source, not speculative catalogues.

```bash
git clone --depth 1 --branch <version-tag-or-required-branch> <official-repository-url> "$HOME/.deslop/repos/<repository>-<version>"
```

**Verify.** Remote/commit before citation. Default branch is not consumed-version proof. Shared checkouts are read-only; clone a separate version when needed. No dependency install/build just to read.

## Local transcript recovery

Find a t3 thread's transcript (Claude session or Codex rollout) from its id:

```bash
S=$(sqlite3 ~/.t3/userdata/state.sqlite "select coalesce(json_extract(resume_cursor_json,'$.resume'), json_extract(resume_cursor_json,'$.threadId')) from provider_session_runtime where thread_id = '<thread id>'")
ls ~/.claude/projects/*/$S.jsonl ~/.codex/sessions/*/*/*/*$S.jsonl 2>/dev/null
```

Claude agents are in `<session>/subagents/` beside the transcript. Codex children live under `~/.codex/sessions/YYYY/MM/DD/`; the first `session_meta` record's `payload.parent_thread_id` links to the parent provider session, not the T3 thread. Follow it recursively; forked parent messages are not new work.
