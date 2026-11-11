# Deslop

Personal software for one user on two workers: Effect apps, their MCP tools and the shared `@deslop/coding-standards`.

## Scope

- **Task.** No issue tracker: the request is the whole task.
- **Language.** Apps are English-only.
- **Users.** One user on these two workers; no portability, compatibility code or general multi-user platform. Apps and MCP endpoints share sign-in at `auth.mp281x.xyz`, except the public Portfolio. Admins in `GITHUB_ADMINS` let other GitHub accounts in; everyone with access shares app data except Gateway's person-owned AI keys and usage.
- **Releases.** Linear and squash-merged; a newer merge cancels an older release run, so a data change covers everything since the last successful deploy.
- **Data retention.** Local data is disposable. Preserve production data only from the immediately previous release; delete obsolete data.

## Commands

- **Verify.** `vp run fix`, then `vp run test`, defined in `vite.config.ts`; `fix` formats, fixes and runs every check CI's `vp run check` makes.
- **Generators.** `vp create app -- --name <name>` (`--kind mobile` for iOS) and `vp create package -- --name <name>`, then `vp install`; never copy one. Before the first mobile push: `.github/releasing.md`, **Publish an iOS app**.
- **Updates.** `vp update -r`; `vp outdated -r` then lists only pins. New checks since the last review: `@effect/tsgo`'s README table and changelog, each lint plugin's `rules` against its previous version, Fallow's release notes. Count a candidate rule's hits with `vp exec effect-tsgo --tsrs-lint vp lint -D <rule>`; ask before one that reverses a house form or rewrites hundreds of sites, with a bad example, a good example and its count.
- **Releases.** `.github/releasing.md`: Simulator builds, deploy, native tools, publishing packages and iOS apps.
- **Agent configuration.** `.claude/agents/pair.md` = `.codex/instructions.md` from `# Work` down. Each file keeps its own `# Harness` lines for its harness's tools. Skills live in `.claude/skills`, shared by both harnesses. Change the installed `~/deslop` only through a merged PR, never while other threads use it.
- **Standards policy.** Each policy is defined once. Only custom rules have tests; a tool upgrade must not opt into new rules, and a declined rule is left out. Each check belongs to the tool that covers it best, proven with the custom rule's failing cases; the compiler and the Effect rules own theirs. A check a parser can make is a static rule; one that needs the whole codebase belongs to code review. Do not add per-package typecheck scripts. Keep only checks that can fire in the codebases using them, including preventive checks for patterns already encountered. Custom rules earn their place with coverage or a safe fix no native rule offers, and intended forms stay accepted while fixes converge.

## Patterns

- **Primitives.** In `packages/components-web`, run `vpx shadcn@latest add --all --overwrite`, point `cn` imports at `#lib/utils.ts`, drop the `cn` dependency and fix only compiler rejections.
- **Software marks.** Run `vpx shadcn@latest add @svgl/<name>` there; move `src/components/ui/svgs/` to canonical `src/ui/svgs/`, keeping registry artwork.

## Choices

Review owns codebase-wide choices; lint owns what one file shows.

- **AI.** Use the Effect AI provider module in the consuming service, over Gateway's `AiGateway`; no wrapper package.
- **Data.** Use Effect KeyValueStore under `ServerRuntime.dataDirectory` (`~/.deslop/<app>/` installed, `.deslop/<app>/` in a checkout); settings as flags, secrets in `~/.deslop/<app>.env`, defaults through `Config.withDefault`.
- **Processes.** Named states and events use `@typeonce/effect-machine`: `Machine.start` in the owning service, `AtomMachine` from `@typeonce/effect-machine/reactivity` on a client, `MachineState` from `@typeonce/effect-machine-react` to render.
- **Clients.** React reads an `AtomRpc.Service` over `WebRuntime.layer` (Scope's page: `layerProtocol`, so it never traces itself) or its `MobileSession`'s `protocol`; a stream syncs one keep-alive atom; a command line uses a scoped `RpcClient.make`.
- **Ownership.** An outside source's answer belongs to the service consuming it; page-private pieces stay with their page; shared behavior has one owner; a new abstraction adds a capability or lightens what a reader holds, never just shorter files. Domain names and plain control flow over wrappers and configuration languages.
- **Imports.** Use wildcard `#` aliases with extensions; a service package exports only `./schema`, `./service` and `./utils`. `readonly` only where a type needs it.
- **Arguments.** Short, independent arguments stay positional; a parameter list is never wrapped in one object just to name them.
- **Personal tools.** npm app CLIs with `service` subcommands, every dependency bundled and native tools in `bin/`, persistent HTTP MCP and a small web UI through `CliRuntime.runApp`; no stdio bridge, container or download command. Telemetry goes to Scope's public OTLP/HTTP JSON receiver, with no Collector.
- **MCP tools.** Serve what an agent needs, not every page action, with the fewest calls and tokens: descriptions lead with when to call, inputs take only what they need, and outputs omit empty keys, use ISO-8601 times, never duplicate a field and carry only the id the next call takes. Apps whose work an agent does not need, such as Trips, OPM and Portfolio, serve none.
- **Auth.** Browser sign-in and standard OAuth with client-managed credentials, never a pasted key. Without `--auth` everyone is the developer behind the loopback, IP and `--url` allowlist; an explicit `--auth` is always enforced; one origin check lives in the runtime. Auth signs one short-lived access token every app, Gateway included, verifies itself, never calling Auth per request; each app's server keeps its own sign-in for its browser and iOS clients. A code approves one sign-in, from a signed-in browser or by the agent through Auth's `answer_request`; a command-line tool such as `coding-standards` signs in with a device code approved that way.
- **Tests.** Keep owned runtime behavior that fails when it breaks and survives an equivalent implementation: E2E from the input to its outcome and failures, no test a fix alone earns.
- **Dependencies.** Keep them in their owning packages on `latest`, pinned only where a peer, the Expo SDK or Vite+ fixes them, and update coupled packages together. Tools run through their own flags and defaults, with no wrapper scripts. Libraries only through published releases: no patches, forks, overrides or shims, shadcn registry components excepted; a release's wrong metadata may be corrected with `packageExtensions` beside a comment naming the upstream defect.

## Design

Before UI work, read the web and mobile themes, the shipped `base-lyra` primitives in `packages/components-web` and neighbouring pages.

- **Intent.** Compact power-user tools: few clicks; icons, position and colour lead; explanations on hover or focus; omit anything adding little. Portfolio is exempt: its own fonts, hotkeys, presence text and artwork, including a 504×504 touch icon on `#fafafa`.
- **Targets.** 3440×1440 (workspaces fill it; lists stay centred), 1920×1080, ~1512×982; iPhone Air 420×912pt, safe areas and Dynamic Type. Check the appearance shown.
- **Colour.** Only identity and status carry hue; app hues follow their icons across apps. Services without Deslop icons stay grey except Deploy's usage bands. Magnitude steps one hue's opacity; chrome stays low-luminance against burn-in. Views update in real time: never label healthy, live, connected or up-to-date states. Dots mark problems, never kinds; kinds take tinted icons.
- **Layout.** No page titles, search fields or panel headers; phone controls stay in the bar. Web semibold only for the bar's app name; no decorative shadows, only popups raised. iOS uses native navigation and large titles, no custom bar. Trees have no connectors, tints or fold carets; pin parents.
- **Behavior.** URL for views; memory only for transient input. Whole rows open content; trailing actions: one icon button or one … menu. No web removal controls (agents use MCP) or context menus; iOS keeps native long-press menus and swipes. No command palette or hotkeys. Never confirm destruction; iOS removal waits eight seconds in-row with Undo before reaching the server. Show each fact once.
- **Recovery.** Retain authorised content through outages; one bar dot shows the oldest stale reader's age, one retry refreshes all; leave rows and panes unmarked. Blocking failure: one destructive retry button with icon and short reason; denial: lock and clear retained content. Diagnostics go to Scope. Failed mutations stay on their action; destructive failures say whether they committed.
- **Components.** Use each primitive for its job; add new looks as variants there first, never repaint at call sites. Segmented choices use stock default Tabs. States: one centred symbol or first-run action; only failure buttons carry words. Keep bars, navigation and pane geometry mounted; skeletons match server content, never bars, controls or axes. Splits remain resizable. Transient failures stay beside content, never toasts or page-moving banners. One icon set per surface. Native names mirror web over `@expo/ui` SwiftUI. Nothing animates; pending actions keep their label, disabled, without spinners.
- **Artwork.** Canonical and transparent; never redraw or recolour in a UI pass. Copy Kanagawa pixel art unchanged: `crispEdges`, integer scaling; indexed touch icons crop 192 to 180px on `#0d0c0c`.

## Documents

Each fact has one home: code, then lint; this file for repository operation, the user's choices and design, an app's `AGENTS.md` for product intent, the web and mobile themes for tokens, `.github/releasing.md` for releases, a published package's `README.md` for its contract, skills for procedures and for the shape of a reply, page or PR body, and the PR template for reviewer-facing sections. Comments are a rare fallback: names and structure explain the code, and a comment gives only a reason they cannot show, in one short sentence.
