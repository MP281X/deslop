# Deslop

Personal apps with one user, who also develops them.

- **No compatibility.** Any route, RPC, key or stored shape may break: delete aliases and redirects.
- **Data.** Tables change only through a new numbered migration in their service, run on a copy of production with row counts compared. Data outside SQL is disposable.
- **Access.** Only Auth identifies callers, by tailnet device or GitHub sign-in. Apps have no sign-in of their own.
- **Dependencies.** New ones are the user's pick. Stay on `latest` except the pins in manifests. No patches or forks.
- **Proof.** Build and prove UI in the browser at the iPhone Duo sizes below. Use the Duo Simulator only for iPhone-only views and native features: share extensions, push, Live Activities, the Dynamic Island and widgets. A blocked proof, such as a missing tool or a failing signed build, is a fault to fix, not a "Not proven" line.
- **Not wanted.** An AI wrapper package; a stdio bridge, container or OpenTelemetry Collector (apps send telemetry straight to Scope); MCP tools for apps agents don't need (Trips, OPM, Portfolio).
- **Pull requests.** Once its review and re-checks pass and Verify passes on its head, rebased on the latest `main`, mark the PR ready.
- **Tests.** Only our own logic, with Effect layer stand-ins. No UI, request or regression tests.

## Commands

- Checks: `vp run fix`, `vp run check` and `vp run test`; the two generators have no tests, so a change to one is proven by creating an app or package with it and building it.
- A contract change is done only when its built server starts on scratch data and serves the changed RPCs or MCP tools.
- New apps and packages: `vp create app -- --name <name>` or `vp create package -- --name <name>`. Never copy one.
- Every app has a web app and an iPhone app, and Effect RPC over SQL. Each screen's model, messages and queries are written once and drawn by `@deslop/design/web` and `@deslop/design/native` (Effect UI with Effect UI kit, and Effect UI native without React), pinned to one `pkg.pr.new` commit and styled with the design package's style objects. Logos come from svgl.
- Web apps install from Safari for the PC; on the iPhone Duo, use the iPhone apps. They build with Expo's local tools, never EAS, and update from their own server through `expo-updates`; only a native change goes through TestFlight. Use Swift only for share extensions and WidgetKit.
- After adding or removing a skill, rerun the agent links in the maintenance reference.

## Design

- One axis: black only, the system font (SF Pro, then Geist on the web) with tabular figures for numbers, SF Mono (then Geist Mono) for scales. iOS draws the iPhone apps' toolbar buttons; web controls are plain and solid, with no imitation glass. Use the same SF Symbols on the web and in the iPhone toolbar. Portfolio keeps its own design.
- Hue only for identity and status. Never label healthy states. Dots mark problems.
- One row everywhere: a title, one muted line, numbers or time at the trailing edge; a problem's dot goes before the title and its reason on the muted line.
- The list stands beside the opened item, and Mail's sidebar button collapses it. The fold is the only divider.
- The inner screen's extra room shows more fields and more items, never bigger things.
- No page titles, panel headers, web search fields, hotkeys, web delete buttons, delete confirmations, custom iOS bar or banners that move the page.
- Loading shows skeletons shaped like the real rows and detail, including on cold opens and deep links. Use view transitions for iOS motion: one-pane detail slides from the trailing edge, sheets rise from below, and split changes cross-fade.
- Rows and controls respond on touch-down and release when scrolling starts. Keep selection only while its detail is beside it, and return through history to the same list position. Each pane scrolls independently with the system indicator.
- Menus open from their controls and check the current choice. Use iOS menus in the iPhone apps. Keep sheet actions above the keyboard and turn spatial transitions into a short fade with Reduce Motion.
- Targets: 3440×1440, 1920×1080, 1512×982 and the iPhone Duo folded (466×678), open (669×951), both rotated, and half-open; its Safari is 382 px wide folded.
- Artwork stays unchanged. Pixel art uses `crispEdges` and integer scaling.

## Agent instructions

Write only what an agent would otherwise get wrong. Give agents the fewest steps and moving parts that do the job: each extra one can fail or break what he relies on, as a worktree per delegate kept a PR's changes out of his file tree. Replay a prompt or skill change on a real past message before merging.
