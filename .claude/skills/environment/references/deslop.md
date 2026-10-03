# Deslop

- `/home/mp281x/deslop`, GitHub `MP281X/deslop`, default branch `main`; workspaces `apps/*` (portfolio), `packages/*` (ai, components, runtime), `tools/coding-standards` and `tools/create-*`; shadcn components in `packages/components`, a new one added with `vp run shadcn add <component>`.
- Full check: `vp run check`, then `vp run test`. Format and lint changed files in one call, since lint has no cache: `vp check --fix <path>...`; `vp lint --format=agent <path>...` prints one line per diagnostic.
- CI: GitHub Actions `build-and-deploy`. Production uses `tools/compose.yaml`, project `deslop`: traefik, portfolio, jaeger, collector (public OTLP https://otel.mp281x.xyz; loopback diagnostics in workflow's browser procedure).
- Preview, from the app directory: `HOST=127.0.0.1 PORT=<port> vp run preview`.

### Repository map

Deslop is the reusable app template and portfolio reference, not a workflow package. CODING_STANDARDS.md owns repository/domain decisions; native bases read it directly, with no AGENTS.md.

- apps/portfolio/src/rpcs/{contracts,handlers}.ts owns the live visitor/trail demonstration: portfolio.join streams state and portfolio.move updates position. lib/portfolio.ts holds pure state helpers; routes/(home)/index.tsx renders the experience. The app composes runtime through main.client.tsx/main.server.ts; no app services directory exists yet.
- packages/runtime/src/{client,server}.ts owns shared client/server layers; src/vite/{config,server}.ts owns app Vite composition and the development source-host seam. packages/components/src/theme.css owns shared tokens and uses prefers-color-scheme for dark mode; components/ui is shadcn-owned.
- packages/ai owns provider/tool composition and compact conversation state; lib/utils.test.ts is the narrow pure prompt-history/reducer seam. tools/create-app and tools/create-package own actual file templates and creation; tools/coding-standards owns public rules, types and the three skills.
- Personal configuration is outside workspace packages: `.claude/skills` owns global sources, `.codex/skills` their explicit aliases. Claude's pair is the canonical base; Codex instructions alias it, and the repository-only `workflow-maintenance` Install recipe aliases the installed Codex base to the installed Claude pair. That recipe owns global installation, not edits to installed homes; its memory and public generated skills are excluded. This repository has no `.agents` directory.

### Fast iterations

Use initialized source exports and the existing app/test seam; no production build between unsettled trials.

```bash
# Pure Effect/AI transformation, from the root: no provider or service startup
vp test packages/ai/src/lib/utils.test.ts
# Generator replacement behavior, before creating full app/package outputs
vp test tools/create-package/src/replace-directory.test.ts
# Real React + RPC source host, from apps/portfolio on a free port
HOST=127.0.0.1 vp dev --host 127.0.0.1 --port <port> --strictPort
```

Vite reloads backend source too: verify the affected RPC. Templates are outside normal lint/type/test inputs; prove representative generated output, then all required outputs once settled. Production preview checks built output; final repository checks use stable code.
