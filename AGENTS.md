# Deslop

## Scope

- **Task.** No issue tracker: the request is the whole task.
- **Language.** Apps are English-only.
- **Users.** One user on three workers: two Debian ones and a Mac whose only Deslop app is Deploy; no portability or general multi-user platform. Everyone with access shares app data except Gateway's person-owned AI keys and usage. Portfolio is public.
- **Compatibility.** Never considered: the apps are personal software that their one user also develops. A change may break any URL, route, RPC or tool name, environment key, wire format, stored shape or installed build; keep no alias, redirect, fallback, version check, conversion or transition window for the old one, and delete any that exists.
- **Data.** A table changes shape through a numbered SQL migration, the only migration allowed and the only code that knows an earlier shape. Everything stored outside SQL is disposable, production included.
- **Releases.** Linear and squash-merged; a newer merge cancels an older release run.
- **Release job conditions.** GitHub propagates skipped jobs through dependency chains; jobs after optional verification need an explicit status function and the successful gate's result.

## Commands

- **Verify.** `vp run fix`, then `vp run test`; `fix` covers CI's `vp run check` in `vite.config.ts`.
- **Server contracts.** A contract change is not done until its built server starts with scratch data and serves the affected MCP tools or RPCs; build and static checks do not register tools.
- **Judge.** `vp run judge` exists but is parked: each Haiku call can cost money from the signed-in person's connected Anthropic account through Gateway. Do not run it unless the user explicitly asks; never in CI, `fix`, `check`, `test` or Verify.
- **Generators.** `vp create app -- --name <name>` (`--kind mobile` for iOS) and `vp create package -- --name <name>`, then `vp install`; never copy one. A new app's first release, mobile before its first push: `.github/releasing.md`, **A new app**.
- **Updates.** `vp update -r`; `vp outdated -r` then lists only pins. New checks since the last review: `@effect/tsgo`'s README table and changelog, each lint plugin's `rules` against its previous version, Fallow's release notes. Count a candidate rule's hits with `vp exec effect-tsgo --tsrs-lint vp lint -D <rule>`; ask before one that reverses a house form or rewrites hundreds of sites, with a bad example, a good example and its count.
- **Releases.** `.github/releasing.md`: a new app or tool, following a release, Simulator builds, native tools.
- **Agent configuration.** `.claude/agents/pair.md` = `.codex/instructions.md` from `# Work` down. Each file keeps its own `# Harness` lines for its harness's tools. Skills live in `.claude/skills`, shared by both harnesses. Change the installed `~/deslop` only through a merged PR, never while other threads use it.
- **Standards policy.** Define each policy once, in the best tool; prove replacements with the custom rule's failing cases. Only custom rules have tests; upgrades never opt into new rules, and declined rules stay out. The compiler and Effect rules own their checks. Parser checks are static; codebase-wide checks belong to review. No per-package typecheck scripts. Checks must be reachable in consuming codebases, including prevention of encountered patterns. Custom rules must add coverage or safe fixes beyond native rules; accept intended forms and make fixes converge. The repository's explicit dependency allowlist lives in root lint, not the published preset. Oxlint applies import-group negations across patterns: compose the allowlist and preset restrictions in one ordered group.

## Patterns

- **Primitives.** In `packages/components-web`, run `vpx shadcn@latest add --all --overwrite`, point `cn` imports at `#lib/classes.ts`, drop the `cn` dependency and fix only compiler rejections.
- **Software marks.** Run `vpx shadcn@latest add @svgl/<name>` there; move `src/components/ui/svgs/` to canonical `src/ui/svgs/`, keeping registry artwork but renaming any SVG id another mark already uses (`a` → `edge-a`).

## Choices

- **AI.** No AI wrapper package.
- **Ownership.** Abstractions add capability or ease reading, not just shorter files; domain names and plain control flow over wrappers and configuration languages.
- **Imports.** A service folder shows only `schema.ts`, `service.ts` and `lib/utils.ts`; its own files reach the rest with `./`. The runtime is imported by side: `shared`, `server`, `client`, `web`, `mobile`, `config`.
- **Arguments.** Short, independent arguments stay positional, not wrapped just to name them.
- **Search serialization.** TanStack serializes both raw parsed search and validated/transformed search. Encode Option transforms through the app's Struct codec before the library's default serialization; both forms are current library inputs, and unrelated keys stay intact.
- **Personal tools.** No stdio bridge, container, download command or telemetry Collector.
- **MCP tools.** Serve agent work, not every page action; none for apps agents do not need, including Trips, OPM and Portfolio.
- **Auth.** Never a pasted key.
- **Tests.** Prove only our observable logic, once, through plain values or service answers with Effect layer stand-ins. No UI, request, library, internals, absence or superseded-code regression tests; table models against migrations are the sole repository-wide exception. A fix alone earns no test.
- **Dependencies.** Keep dependencies in their owning packages on `latest`; pin only for peers, the Expo SDK or Vite+; update coupled packages together. Tools use their own flags and defaults, no wrapper scripts. Libraries only through published releases: no patches, forks, overrides or shims, except shadcn registry components. Correct wrong metadata with `packageExtensions` and a comment naming the upstream defect.
- **Native ownership.** Expo autolinks transitive native dependencies and applies their automatic config plugins even when an app never imports them. App-only native modules and their helpers belong in the apps that use them, not shared packages.
- **Native fingerprints.** The shared Expo config helper's source is excluded; resolved configuration does not include inline plugin or mod bodies. Their implementations need their own fingerprinted module.

## Design

- **References.** Themes: `packages/components-web/src/theme.css`, `packages/components-mobile/src/theme.ts`; `base-lyra` primitives: `packages/components-web/src/ui/`; generators: `tools/create-{app,package}/`.
- **Exemption.** Portfolio is exempt: its own fonts, hotkeys, presence text and artwork, including a 504×504 touch icon on `#fafafa`.
- **Targets.** 3440×1440, 1920×1080, ~1512×982; iPhone Air 420×912pt, safe areas and Dynamic Type.
- **Colour.** Only identity and status carry hue; services without Deslop icons stay grey except Deploy's usage bands. Never label healthy, live, connected or up-to-date states. Dots mark problems, never kinds; kinds take tinted icons.
- **Layout.** No page titles or panel headers, and no search fields on the web. Web semibold only for the bar's app name; no decorative shadows, only popups raised. No custom iOS bar. Trees have no connectors, tints or fold carets.
- **Behavior.** No web removal controls or context menus; iOS keeps native long-press menus and swipes. No command palette or hotkeys. Never confirm destruction.
- **Recovery.** Leave stale rows and panes unmarked; no toasts or page-moving banners. Destructive failures say whether they committed.
- **Components.** Nothing animates; pending actions have no spinners.
- **Tracing.** Background work rounds are traced; animation ticks, including Portfolio's occupied-room wandering, are not.
- **Artwork.** Canonical and transparent; never redraw or recolour in a UI pass. Copy Kanagawa pixel art unchanged: `crispEdges`, integer scaling; indexed touch icons crop 192 to 180px on `#0d0c0c`.

## Documents

- **Homes.** Each fact lives once: code, then lint; here for operation and user choices; app `AGENTS.md` for product intent; themes for tokens; `.github/releasing.md` for releases; published package `README.md` for its contract; skills for procedures and reply, page or PR shape; PR template for reviewer-facing sections.
