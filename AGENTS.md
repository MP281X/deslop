# Deslop

Personal apps with one user, who also develops them.

- **No compatibility.** Any route, RPC, key or stored shape may break. Delete aliases, redirects and fallbacks.
- **Data.** Tables change only through a new numbered migration in their service, run on a copy of production with row counts compared. Data outside SQL is disposable.
- **Access.** Only Auth identifies callers, by tailnet device or GitHub sign-in. Apps have no sign-in of their own.
- **Dependencies.** New ones are the user's pick. Stay on `latest` except the pins in manifests. No patches or forks.
- **Proof.** A PR whose changed flow nobody ran can't go ready. A blocked proof, such as a missing tool or a failing signed build, is a fault to fix, not a "Not proven" line.
- **Not wanted.** An AI wrapper package; a stdio bridge, container or OpenTelemetry Collector (apps send telemetry straight to Scope); MCP tools for apps agents don't need (Trips, OPM, Portfolio).
- **Tests.** Only our own logic, with Effect layer stand-ins. No UI, request or regression tests.

## Commands

- `vp run fix` before pushing; `vp -C <package> run test` for packages you touched.
- A contract change is done only when its built server starts on scratch data and serves the changed RPCs or MCP tools.
- New apps and packages: `vp create app -- --name <name>` (`--kind mobile` for iOS) or `vp create package -- --name <name>`. Never copy one.
- Web components: `vpx shadcn@latest add --all --overwrite` in `packages/components-web`; never edit the registry files. Logos come from svgl.
- After adding or removing a skill, rerun the agent links in the maintenance reference.

## Design

- `palette.ts` mirrors `theme.css`.
- Hue only for identity and status. Never label healthy states. Dots mark problems.
- No page titles, panel headers, web search fields, hotkeys, custom animations, web delete buttons, delete confirmations, custom iOS bar or banners that move the page.
- Targets: 3440×1440, 1920×1080, 1512×982 and iPhone Air.
- Artwork stays unchanged. Pixel art uses `crispEdges` and integer scaling.

## Agent instructions

Write only what an agent would otherwise get wrong. Replay a prompt or skill change on a real past message before merging.
