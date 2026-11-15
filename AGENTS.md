# Deslop

## Scope

- **Task.** No issue tracker: the request is the whole task.
- **Language.** Apps are English-only.
- **Users.** One user on three workers: two Debian ones and a Mac whose only Deslop app is Deploy; no portability or general multi-user platform. Everyone with access shares app data except Gateway's person-owned AI keys and usage. Portfolio is public.
- **Access.** Auth alone names callers: a tailnet device is its owner without signing in, anyone else signs in once with GitHub into Auth's cookie on the parent domain, and an app on Auth's machine may act for a person. Apps keep no sign-in, token or credential of their own.
- **Compatibility.** Never considered: the apps are personal software that their one user also develops. A change may break any URL, route, RPC or tool name, environment key, wire format, stored shape or installed build; keep no alias, redirect, fallback, version check, conversion or transition window for the old one, and delete any that exists.
- **Data.** A table changes shape through a numbered SQL migration, the only migration allowed and the only code that knows an earlier shape. Everything stored outside SQL is disposable, production included.
- **Releases.** Linear and squash-merged.
- **Release job conditions.** GitHub propagates skipped jobs through dependency chains; jobs after optional verification need an explicit status function and the successful gate's result.

## Commands

| Role   | Command        | Runs                                                                            |
| ------ | -------------- | ------------------------------------------------------------------------------- |
| Fixer  | `vp run fix`   | In **Validate** and before each push; covers `check`                            |
| Checks | `vp run check` | In CI                                                                           |
| Tests  | `vp run test`  | In CI; **Validate** runs each touched package's with `vp -C <package> run test` |

- **Ready.** A settled PR is marked ready once CI is green, with no extra Validate run, so the user merges settled PRs one by one.
- **Server contracts.** A contract change is not done until its built server starts with scratch data and serves the affected MCP tools or RPCs; build and static checks do not register tools.
- **Judge.** `vp run judge` runs only when the user asks, never in CI, `fix`, `check`, `test` or Validate, because each Haiku call bills the signed-in person's Anthropic account through Gateway.
- **Generators.** `vp create app -- --name <name>` (`--kind mobile` for iOS) and `vp create package -- --name <name>`, then `vp install`; never copy one. A new app's first release, mobile before its first push: `.github/releasing.md`, **A new app**.
- **Updates.** `vp update -r`; `vp outdated -r` then lists only pins. New checks since the last review: `@effect/tsgo`'s README table and changelog, each lint plugin's `rules` against its previous version, Fallow's release notes. Count a candidate rule's hits with `vp exec effect-tsgo --tsrs-lint vp lint -D <rule>`; ask before one that reverses a house form or rewrites hundreds of sites, with a bad example, a good example and its count.
- **Releases.** `.github/releasing.md`: a new app or tool, following a release, Simulator builds, native tools.
- **Agent configuration.** `.claude/agents/pair.md` = `.codex/instructions.md` from `# Work` down; each keeps its own `# Harness`. Skills in `.claude/skills` serve both harnesses. The installed `~/deslop` changes only through a merged PR.
- **Standards policy.** Define each policy once, in the best tool; prove replacements with the custom rule's failing cases. Only custom rules have tests; upgrades never opt into new rules, and declined rules stay out. The compiler and Effect rules own their checks. Parser checks are static; codebase-wide checks belong to review. No per-package typecheck scripts. Checks must be reachable in consuming codebases, including prevention of encountered patterns. Custom rules must add coverage or safe fixes beyond native rules and accept intended forms; each rule's accepted examples and automatic fixes pass the whole preset, not only that rule, and repeated fixes reach a fixed point.

## Patterns

- **Primitives.** In `packages/components-web`, run `vpx shadcn@latest add --all --overwrite` and fix only compiler rejections; the registry's files import `cn` from the `cn` package, which `#lib/utils.ts` re-exports for ours. The registry files otherwise stay untouched: no local variants, and a layout a primitive does not fit changes instead.
- **Software marks.** Run `vpx shadcn@latest add @svgl/<name>` there; move `src/components/ui/svgs/` to canonical `src/ui/svgs/`, keeping registry artwork but renaming any SVG id another mark already uses (`a` → `edge-a`).
- **Mobile marks.** Fetch svgl's raw file from `https://svgl.app/library/<name>.svg` (`https://api.svgl.app?search=<title>` lists the names, light and dark apart) into `packages/components-mobile/src/ui/svgs/` unchanged, and import it as `@deslop/components-mobile/ui/svgs/<name>.svg`.

## Choices

- **AI.** No AI wrapper package.
- **Ownership.** Abstractions add capability or ease reading, not just shorter files; domain names and plain control flow over wrappers and configuration languages.
- **Imports.** A service folder shows only `schema.ts`, `service.ts` and `lib/utils.ts`; its own files reach the rest with `./`. The runtime is imported by side: `shared`, `server`, `client`, `web`, `mobile`, `config`.
- **Arguments.** Short, independent arguments stay positional, not wrapped just to name them.
- **Model tags.** `toTaggedUnion.guards` validates the whole case, including a model class's instance identity, so JSON decoded to plain objects fails them: discriminate already-typed values with the union's `isAnyOf` (`Booking.isAnyOf`).
- **Search serialization.** TanStack serializes both raw parsed search and validated/transformed search. Encode Option transforms through the app's Struct codec before the library's default serialization; both forms are current library inputs, and unrelated keys stay intact.
- **Personal tools.** No stdio bridge, container, download command or telemetry Collector.
- **MCP tools.** Serve agent work, not every page action; none for apps agents do not need, including Trips, OPM and Portfolio.
- **Auth.** Never a pasted key.
- **Tests.** Prove only our observable logic, once, through plain values or service answers with Effect layer stand-ins. No UI, request, library, internals, absence or superseded-code regression tests; table models against migrations are the sole repository-wide exception. A fix alone earns no test.
- **Dependencies.** Never add a dependency without asking the user. Keep dependencies in their owning packages on `latest`; pin only for peers, the Expo SDK or Vite+; update coupled packages together. Tools use their own flags and defaults, no wrapper scripts. Libraries only through published releases: no patches, forks, overrides or shims, except shadcn registry components. Correct wrong metadata with `packageExtensions` and a comment naming the upstream defect.
- **Native ownership.** Expo autolinks transitive native dependencies and applies their automatic config plugins even when an app never imports them. App-only native modules and their helpers belong in the apps that use them, not shared packages.
- **Native fingerprints.** The shared Expo config helper's source is excluded; resolved configuration does not include inline plugin or mod bodies. Their implementations need their own fingerprinted module.

## Design

- **Palette.** Mobile `palette.ts` mirrors `theme.css` in sRGB hex; a change to one changes the other in the same commit.
- **References.** Themes: `packages/components-web/src/theme.css`, `packages/components-mobile/src/palette.ts` and `theme.ts`; `base-lyra` primitives: `packages/components-web/src/ui/`; generators: `tools/create-{app,package}/`.
- **Exemption.** Portfolio is exempt: its own fonts, hotkeys, presence text and artwork, including a 504×504 touch icon on `#fafafa`.
- **Targets.** 3440×1440, 1920×1080, ~1512×982; iPhone Air 420×912pt, safe areas and Dynamic Type.
- **Colour.** Only identity and status carry hue; services without Deslop icons stay grey except Deploy's usage bands. Never label healthy, live, connected or up-to-date states. Dots mark problems, never kinds; kinds take tinted icons.
- **Layout.** No page titles or panel headers, and no search fields on the web. Web semibold only for the bar's app name; no decorative shadows, only popups raised. No custom iOS bar. Trees have no connectors, tints or fold carets.
- **Behavior.** No web removal controls; iOS keeps native long-press menus and swipes. No hotkeys. Never confirm destruction.
- **Recovery.** Leave stale rows and panes unmarked; no page-moving banners. Destructive failures say whether they committed.
- **Components.** Only shadcn's own animations.
- **Tracing.** Background work rounds are traced; animation ticks, including Portfolio's occupied-room wandering, are not.
- **Artwork.** Canonical and transparent; never redraw or recolour in a UI pass. Copy Kanagawa pixel art unchanged: `crispEdges`, integer scaling; indexed touch icons crop 192 to 180px on `#0d0c0c`.

## Documents

**Homes.** Each fact lives once, in the first home its kind matches:

| Kind                                                     | Home                                                       |
| -------------------------------------------------------- | ---------------------------------------------------------- |
| What code or lint can enforce                            | The code, then a lint rule                                 |
| This repository's operation and the user's choices in it | This file                                                  |
| An app's product intent                                  | That app's `AGENTS.md`                                     |
| Tokens                                                   | The themes                                                 |
| Releases                                                 | `.github/releasing.md`                                     |
| A published package's contract                           | Its `README.md`                                            |
| Workers, accounts, services and Dual                     | The environment skill and its references                   |
| Planning, delegate routing and briefs                    | The orchestrator skill                                     |
| Outside repositories                                     | The orchestrator skill's `references/repos.md`             |
| PR shape and lifecycle                                   | The pull-requests skill; section guidance, the PR template |
| Checks, proof and review                                 | The verification skill                                     |
| Thread and PR output                                     | The prompts' Replies section                               |
| Rules for every turn                                     | The prompts' `# Work`                                      |

- **Form.** In agent instructions, state only what a reader would otherwise get wrong, never the implicit or what is no concern; a process is a Mermaid `stateDiagram-v2` whose transitions read `event [guard] / action`, a lookup is a table, and bullets hold only standing rules; no prose restates a diagram.
