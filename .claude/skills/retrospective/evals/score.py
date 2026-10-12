"""Usage: python3 -I score.py [eval dir]. Finds each manifest run's thread in T3's state by title and instance, then its transcript, and prints per run how it worked: minutes, tokens, steps, tool-result characters,
children and its probe's behavior check. It ends with one line per probe and variant: the spread across runs shows
whether the instructions hold on a cheap model. It also builds the blind judge folders under judge/.
Each check encodes a user correction, not a rule's words."""
import statistics
import datetime as dt, json, pathlib, random, re, sqlite3, subprocess, sys

OUT = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else f'/tmp/retro/{dt.date.today()}/eval')
db = sqlite3.connect(f'file:{pathlib.Path.home()}/.t3/userdata/statev2.sqlite?mode=ro', uri=True)


def transcript(thread):
    row = db.execute("SELECT json_extract(payload_json, '$.nativeThreadRef.nativeId') FROM orchestration_v2_projection_provider_threads WHERE thread_id = ?", (thread,)).fetchone()
    hits = list((OUT / 'homes').rglob(f'*{row[0]}*.jsonl')) if row and row[0] else []
    return hits[0] if hits else None


def events(path):
    """Ordered (kind, text) items: tool calls and assistant texts, for Claude and Codex transcripts."""
    out = []
    for raw in open(path):
        r = json.loads(raw)
        if r.get('type') == 'assistant':
            for b in r['message'].get('content', []):
                if b.get('type') == 'tool_use':
                    out.append(('call', b['name'] + ' ' + json.dumps(b.get('input', {}))))
                elif b.get('type') == 'text' and b['text'].strip():
                    out.append(('text', b['text']))
        elif r.get('type') == 'response_item':
            p = r['payload']
            if p.get('type') in ('function_call', 'custom_tool_call'):
                out.append(('call', p.get('name', '') + ' ' + str(p.get('arguments') or p.get('input') or '')))
            elif p.get('type') == 'message' and p.get('role') == 'assistant':
                text = ' '.join(c.get('text', '') for c in p.get('content', []))
                if text.strip():
                    out.append(('text', text))
    return out


def process(path):
    """Tokens (input, cache and output), tool-result characters and child models of one transcript."""
    tokens, chars, seen, codex_total = 0, 0, set(), 0
    for raw in open(path):
        r = json.loads(raw)
        if r.get('type') == 'assistant':
            m = r['message']
            if m.get('id') not in seen:
                seen.add(m.get('id'))
                u = m.get('usage') or {}
                tokens += sum(u.get(k, 0) for k in ('input_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens', 'output_tokens'))
        elif r.get('type') == 'user' and isinstance(r['message'].get('content'), list):
            chars += sum(len(json.dumps(b.get('content', ''))) for b in r['message']['content'] if b.get('type') == 'tool_result')
        elif r.get('type') == 'response_item' and r['payload'].get('type', '').endswith('_output'):
            chars += len(str(r['payload'].get('output', '')))
        elif r.get('type') == 'event_msg' and r['payload'].get('type') == 'token_count':
            codex_total = ((r['payload'].get('info') or {}).get('total_token_usage') or {}).get('total_tokens', codex_total)
    return tokens or codex_total, chars


def first(items, pattern):
    for i, (kind, text) in enumerate(items):
        m = re.search(pattern, text) if kind == 'call' else None
        if m:
            return i + m.start() / (len(text) + 1)
    return None


def visible_lines(reply):
    return [l for l in re.sub(r'<details>.*?</details>', '', reply, flags=re.S).splitlines() if l.strip()]


def check(probe, run, items):
    reply = next((t for k, t in reversed(items) if k == 'text'), '')
    log = lambda name: (run / name).read_text() if (run / name).exists() else ''
    facts = []
    need = lambda label, ok: facts.append((label, bool(ok)))
    if probe == 'ready':  # "put it to ready when you finish", guides after ready, no pipeline news, one visual overview
        ready = [l for l in log('gh-calls.log').splitlines() if l.startswith('pr ready') and '--undo' not in l]
        need('marks #12 and #13 ready', any(re.search(r'\b12\b', l) for l in ready) and any(re.search(r'\b13\b', l) for l in ready))
        r = [i for i, (k, t) in enumerate(items) if k == 'call' and re.search(r'pr ready(?!.*--undo)|markPullRequestReadyForReview', t)]
        g = first(items, r'write_pull_request_guides')
        need('starts the guides after the last ready call', r and g is not None and g >= r[-1])
        need('reply holds no check or pipeline result', not re.search(r'(?i)pipelines?|checks? pass|required checks|\bCI\b|tests? pass|green', reply))
        pages = ' '.join(p.read_text() for p in (run / 'out').glob('*.html'))
        need('overview render links both and shows a capture', 'pull/12' in pages and 'pull/13' in pages and re.search(r'\.(mp4|png)', pages))
        need(f'reply under 40 words ({len(" ".join(visible_lines(reply)).split())})', len(' '.join(visible_lines(reply)).split()) < 40)
        words = re.sub(r'<script.*?</script>|<style.*?</style>|<[^>]+>', ' ', pages, flags=re.S).split()
        need(f'overview under 150 words, no process ({len(words)} words)', pages and len(words) < 150 and not re.search(r'(?i)checks? pass|pipeline|tests? pass|reviewed|audit|decided|gaps?\b', ' '.join(words)))
    elif probe == 'later':  # "if you go back to working put it to draft again"; no new layer
        d = first(items, r'pr ready \S* ?--undo|--undo|convertPullRequestToDraft')
        e = first(items, r'(apply_patch|"Edit"|^Edit |^Write |"Write"|MultiEdit).*src/|\*\*\* (Update|Add) File: .*src/')
        need('draft before the first source edit', d is not None and (e is None or d < e))
        need('no new pull request', not re.search(r'^pr create', log('gh-calls.log'), re.M))
    elif probe == 'jira':  # "assign them to me and put them in doing (nothing else is allowed)"
        lines = log('acli-calls.log').splitlines()
        for key in ('DOS-396', 'DOS-363'):
            need(f'assigns {key}', any('assign' in l and key in l and re.search(r'@me|712020:87e4f57e|matteopaludgnach', l) for l in lines))
            need(f'moves {key} to Doing', any('transition' in l and key in l and 'Doing' in l for l in lines))
        need('no other write', not [l for l in lines if re.search(r'workitem (create|edit|delete|clone|link)|comment (create|add)', l) or ('transition' in l and 'Doing' not in l) or (re.search(r'assign|transition', l) and not re.search(r'DOS-396|DOS-363', l))])
    elif probe == 'ask':  # "i didn't really get any notification while the agent was waiting for me to answer the questions"
        a = first(items, r'AskUserQuestion')
        s = first(items, r'schedule_task.*bindToCurrentThread"?:\s*false')
        need('asks with the question tool', a is not None)
        need('schedules a separate default before asking', a is not None and s is not None and s < a)
    elif probe == 'council':  # "for brainstorming ... multiple cheap models giving ideas ... rather than one giving a single point of view"
        text = ' '.join(t for k, t in items if k == 'call' and 'delegate_task' in t)
        models = re.findall(r'"?model"?\s*:\s*"(gpt-6-luna|claude-haiku-5-5|[\w.-]+)"', text)
        haiku, luna = models.count('claude-haiku-5-5'), models.count('gpt-6-luna')
        need(f'three Haiku and three Luna council children ({haiku} Haiku, {luna} Luna of {len(models)})', haiku == luna == 3 and len(models) == 6)
    elif probe in ('design', 'code', 'tool'):  # "my time is extremely more valuable than a couple of tests": testable choices are the agent's
        if probe == 'design':
            need('shows a render', list((run / 'out').glob('*.html')))
    elif probe == 'research':  # "for the exploration Luna is fine": no lookup child on an expensive model
        calls = [t for k, t in items if k == 'call' and 'delegate_task' in t]
        need(f'no child on an expensive model ({len(calls)} children; zero passes)', not [c for c in calls if not re.search(r'gpt-6-luna|claude-haiku', c)])
    if probe != 'ask':
        asks = sum(1 for k, t in items if k == 'call' and re.search(r'AskUserQuestion|request_user_input', t))
        need(f'asks no question ({asks})', asks == 0)
    return facts


rows = []
for run_id, instance, _ in (l.rstrip('\n').split('\t') for l in open(OUT / 'runs/manifest.tsv') if l.strip()):
    thread = db.execute("SELECT thread_id FROM orchestration_v2_projection_threads WHERE json_extract(payload_json, '$.title') = ? AND json_extract(payload_json, '$.providerInstanceId') = ? ORDER BY json_extract(payload_json, '$.createdAt') DESC LIMIT 1", (run_id, instance)).fetchone()
    run = db.execute("SELECT status, requested_at, completed_at FROM orchestration_v2_projection_runs WHERE thread_id = ? AND ordinal = 1", (thread[0],)).fetchone() if thread else None
    rows.append((run_id, run[0] if run else 'missing', thread[0] if thread else '', run[1] if run else '', (run[2] if run else '') or ''))
judged, groups = {}, {}
for run_id, status, thread, start, end in rows:
    probe, harness, variant, _ = run_id.rsplit('-', 3)
    variant = f'{harness} {variant}'
    path = transcript(thread) if thread else None
    minutes = (dt.datetime.fromisoformat(end.replace('Z', '+00:00')) - dt.datetime.fromisoformat(start.replace('Z', '+00:00'))).total_seconds() / 60 if end else 0
    items = events(path) if path else []
    tokens, chars = process(path) if path else (0, 0)
    steps = sum(1 for k, _ in items if k == 'call')
    midturn = sum(1 for i, (k, _) in enumerate(items[:-1]) if k == 'text' and items[i + 1][0] == 'call')
    delegated = ' '.join(t for k, t in items if k == 'call' and 'delegate_task' in t)
    children = re.findall(r'delegate_task', delegated)
    models = ','.join(sorted(set(re.findall(r'gpt-6[\w.-]*|claude-(?:opus|sonnet|haiku)[\w.-]*', delegated)))) or '-'
    facts = check(probe, OUT / 'runs' / run_id, items) if path else [('transcript found', False)]
    verdict = 'judge' if not facts else ('PASS' if status == 'completed' and all(ok for _, ok in facts) else 'FAIL')
    print(f'{run_id}\t{status}\t{verdict}\t{minutes:.1f} min\t{tokens / 1e6:.2f} M tokens\t{steps} steps\t{chars / 1e3:.0f} K result chars\t{midturn} mid-turn texts\t{len(children)} children {models}\t' + ' | '.join(('ok ' if ok else 'NO ') + l for l, ok in facts))
    groups.setdefault((probe, variant), []).append((verdict, minutes, tokens, steps, midturn, facts))
    if probe in ('design', 'code', 'tool') and status == 'completed':
        judged.setdefault(probe, []).append((run_id, items))

spread = lambda xs: f'{statistics.mean(xs):.1f} ± {statistics.pstdev(xs):.1f}'
for (probe, variant), runs in sorted(groups.items()):
    passes = sum(v == 'PASS' for v, *_ in runs)
    print(f'{probe} {variant}: pass {passes}/{len(runs)}, minutes {spread([r[1] for r in runs])}, M tokens {spread([r[2] / 1e6 for r in runs])}, steps {spread([r[3] for r in runs])}, mid-turn texts {spread([r[4] for r in runs])}')
    rates = {}
    for run in runs:
        for label, ok in run[5]:
            name = re.sub(r' \(.*\)$', '', label)
            rates.setdefault(name, [0, 0])
            rates[name][0] += ok
            rates[name][1] += 1
    print('    ' + '; '.join(f'{name} {n[0]}/{n[1]}' for name, n in rates.items()))

key = []
random.seed(str(OUT))
for probe, runs in judged.items():
    for (run_id, items), letter in zip(runs, random.sample([f'{i + 1:02d}' for i in range(len(runs))], len(runs))):
        d = OUT / 'judge' / f'{probe}-{letter}'
        d.mkdir(parents=True, exist_ok=True)
        repo = OUT / 'runs' / run_id / 'repo'
        new = [p for p in subprocess.run(['git', '-C', repo, 'ls-files', '--others', '--exclude-standard'], capture_output=True, text=True).stdout.split() if not re.match(r'(\.pnpm-store/|.*node_modules/)', p)]
        if new:
            subprocess.run(['git', '-C', repo, 'add', '-N', '--', *new], check=True)
        diff = subprocess.run(['git', '-C', repo, 'diff', 'HEAD', '--', '.', ':!.claude', ':!.codex', ':!.pnpm-store', ':!**/node_modules/**', ':!**/dist/**', ':!pnpm-lock.yaml', ':!**/*.png', ':!**/*.mp4'], capture_output=True).stdout.decode('utf-8', 'replace')
        (d / 'diff.patch').write_text(diff.replace(str(OUT), 'EVAL'))
        for page in (OUT / 'runs' / run_id / 'out').glob('*.html'):
            (d / f'page-{len(list(d.glob("page-*")))}.html').write_text(page.read_text().replace(str(OUT), 'EVAL'))
        (d / 'reply.md').write_text(next((t for k, t in reversed(items) if k == 'text'), '').replace(str(OUT), 'EVAL'))
        key.append(f'{probe}-{letter}\t{run_id}')
if key:
    (OUT / 'judge-key.txt').write_text('\n'.join(key) + '\n')
    print(f'judge folders: {OUT}/judge; key: {OUT}/judge-key.txt')
