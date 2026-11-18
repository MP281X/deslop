# Deslop

## Scope

- **Task.** No issue tracker: the request is the whole task.
- **Language.** Apps are English-only.
- **Users.** One user on the environment skill's workers; no portability or general multi-user platform. Everyone with access shares app data except Gateway's person-owned AI keys and usage.
- **Access.** Auth alone names callers: a tailnet device is its owner without signing in, anyone else signs in once with GitHub into Auth's cookie on the parent domain, and an app on Auth's machine may act for a person. Apps keep no independent caller sign-in or access credential; upstream provider keys and service secrets are not caller identity.
- **Compatibility.** Never considered: the apps are personal software that their one user also develops. A change may break any URL, route, RPC or tool name, environment key, wire format, stored shape or installed build; keep no alias, redirect, fallback, version check, conversion or transition window for the old one, and delete any that exists.
- **Data.** A table changes shape through a new numbered SQL migration in its service, never an edit to an existing one, the only migration allowed and the only code that knows an earlier shape. Everything stored outside SQL is disposable, production included.

## Commands

- **Before pushing.** Run `vp run fix`.
- **Package tests.** Run a touched package's tests with `vp -C <package> run test`.
- **Server contracts.** A contract change is not done until its built server starts with scratch data and serves the affected MCP tools or RPCs; build and static checks do not register tools.
- **Migrations.** A migration is not done until it has run on a copy of the production database with row counts compared.
- **Generators.** `vp create app -- --name <name>` (`--kind mobile` for iOS) and `vp create package -- --name <name>`, then `vp install`; never copy one.
- **Updates.** `vp update -r`; `vp outdated -r` then lists only pins. New checks since the last review: `@effect/tsgo`'s README table and changelog, each lint plugin's `rules` against its previous version, Fallow's release notes. Count a candidate rule's hits with `vp exec effect-tsgo --tsrs-lint vp lint -D <rule>`; one that reverses a house form or rewrites hundreds of sites is an item the user picks, with a bad example, a good example and its count.
- **Agent configuration.** Skills in `.claude/skills` serve both harnesses. After adding or removing a skill, follow the maintenance reference's agent links, since Codex reads only linked skills.
- **Standards policy.** Define each policy once, in the best tool; prove replacements with the custom rule's failing cases. Only custom rules have tests; upgrades never opt into new rules, and declined rules stay out. The compiler and Effect rules own their checks. Parser checks are static; codebase-wide checks belong to review. No per-package typecheck scripts. Checks must be reachable in consuming codebases, including prevention of encountered patterns. Custom rules must add coverage or safe fixes beyond native rules and accept intended forms; each rule's accepted examples and automatic fixes pass the whole preset, not only that rule, and repeated fixes reach a fixed point.

## Patterns

- **Primitives.** In `packages/components-web`, run `vpx shadcn@latest add --all --overwrite` and fix only compiler rejections. The registry files otherwise stay untouched: no local variants, and a layout a primitive does not fit changes instead.
- **Software marks.** Run `vpx shadcn@latest add @svgl/<name>` there; move `src/components/ui/svgs/` to canonical `src/ui/svgs/`, keeping registry artwork but renaming any SVG id another mark already uses (`a` → `edge-a`).
- **Mobile marks.** Fetch svgl's raw file from `https://svgl.app/library/<name>.svg` (`https://api.svgl.app?search=<title>` lists the names, light and dark apart) into `packages/components-mobile/src/ui/svgs/` unchanged, and import it as `@deslop/components-mobile/ui/svgs/<name>.svg`.

## Choices

- **AI.** No AI wrapper package.
- **Ownership.** Abstractions add capability or ease reading, not just shorter files; domain names and plain control flow over wrappers and configuration languages.
- **Services.** Keep server effects in `service.ts` and helpers in topic-named `lib/` modules under `src/services/<name>/`. Async page state lives in atoms under a topic-named `src/lib` module.
- **Arguments.** Short, independent arguments stay positional, not wrapped just to name them.
- **Model tags.** `toTaggedUnion.guards` validates the whole case, including a model class's instance identity, so JSON decoded to plain objects fails them. For already-typed values needing only tag discrimination, use the union's `isAnyOf` (`Booking.isAnyOf`); guards are for whole-case validation.
- **Search serialization.** TanStack serializes both raw parsed search and validated/transformed search. Encode Option transforms through the app's Struct codec before the library's default serialization; both forms are current library inputs, and unrelated keys stay intact.
- **Personal tools.** No stdio bridge, container, download command or OpenTelemetry Collector process; apps send telemetry directly to Scope.
- **MCP tools.** Serve agent work, not every page action; none for apps agents do not need, including Trips, OPM and Portfolio.
- **Auth.** Never a pasted key for signing in to Deslop; Gateway's provider-key entry is not sign-in.
- **Tests.** Prove only our observable logic, once, through plain values or service answers with Effect layer stand-ins. No UI, request, library, internals, absence or superseded-code regression tests; table models against migrations are the sole repository-wide exception. A fix alone earns no test.
- **Dependencies.** A new dependency is an item the user picks. Keep dependencies in their owning packages on `latest`; peer, Expo SDK and toolchain constraints live in the manifests and workspace config, not a second prose allowlist; update coupled packages together. Tools use their own flags and defaults, no wrapper scripts. Libraries only through published releases: no patches, forks or shims, except shadcn registry components. Correct wrong metadata with `packageExtensions` and a comment naming the upstream defect; workspace overrides remain explicit there.

## Design

- **Palette.** Mobile `palette.ts` mirrors `theme.css` in sRGB hex; a change to one changes the other in the same commit.
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

| Kind                                                      | Home                                                                                         |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| What code or lint can enforce                             | The code, then a lint rule                                                                   |
| This repository's operation and the user's choices in it  | This file                                                                                    |
| An app's product intent                                   | That app's `AGENTS.md`                                                                       |
| Tokens                                                    | `packages/components-web/src/theme.css`, `packages/components-mobile/src/{palette,theme}.ts` |
| Releases                                                  | `.github/releasing.md`                                                                       |
| A published package's contract                            | Its `README.md`                                                                              |
| Workers, accounts, services and Dual                      | The environment skill and its references                                                     |
| Outside repositories                                      | The environment skill's `references/repos.md`                                                |
| Plans, variants, prototypes, advisors, council and sleep  | The plan skill                                                                               |
| Approved work up to a reviewed draft, models, briefs, PRs | The build skill                                                                              |
| A delegate's own rules                                    | The builder and reviewer skills                                                              |
| Captures and recordings                                   | The captures skill                                                                           |
| PR section guidance                                       | The PR template                                                                              |
| Thread output and the items within PR sections            | The prompts' Replies section                                                                 |
| Rules for every turn                                      | The prompts' `# Work`                                                                        |

- **Form.** In agent instructions, state only what a reader would otherwise get wrong, never the implicit or what is no concern; a process is a Mermaid `stateDiagram-v2` whose transitions read `event [guard] / action`, a lookup is a table, a form the agent must produce is one worked example, and bullets hold only standing rules; no prose restates a diagram.
- **Evals.** A change to a prompt or skill is replayed before it merges, never tried on the next thread: a Claude delegate in the changed worktree answers a real past message, changing nothing, and its reply is scored against what the user complained about in that thread, with its minutes, steps and calls per step. Only Claude reads a worktree's prompt and its new skills; Codex, and edits to a skill already installed, cannot be replayed and say so under Not proven.
