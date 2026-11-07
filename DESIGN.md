# Deslop

Personal tools for a power user: compact, keyboard-first, fast once learned. Icons, position and colour lead; explanation appears on hover or focus. Remove anything that adds little value.

`packages/components-web/src/theme.css` and `packages/components-mobile/src/theme.ts` own tokens; their drift tests cover both appearances. Product intent belongs in each app's `AGENTS.md`.

## Targets

- Desktop: 3440×1440 at 1× on the QD-OLED ultrawide; 1920×1080 on the portable OLED; about 1512×982 on the MacBook. Multi-pane tools fill the screen; a single list keeps a centred reading width.
- iPhone Air: 420×912pt, Dynamic Island and native back navigation. Respect safe areas and Dynamic Type.
- P3 displays throughout. Preserve Kanagawa's original chroma: gamut-independent OKLCH on the web, lossless sRGB equivalents at Expo's native colour boundary. Do not boost saturation.
- Dark uses Kanagawa; light uses neutral white and grey surfaces, never Lotus paper or khaki. Only app and status hues carry colour, darkened to read on white. Validate the appearance actually shown, not an assumed dark-mode default. Printed documents stay light and retain their paper layout.

## Colour and type

- Dragon neutrals: near-black background, one-step neutral selected/hover fill, straight hairlines. Selection is never hue-tinted.
- App identity: Deploy blue, Scope cyan, Gateway pink, Auth slate, Signal violet, Stash amber, Trips orange, OPM ivory. Portfolio keeps its coral bolt. No green.
- Scope sides: server blue, browser pink, iOS amber, CI violet. Deploy machines: dev spring blue, desktop autumn yellow. Kinds use tinted icons, not dots.
- Error red; warning orange. Dots communicate problems and live activity, never health that needs no attention or the kind of a thing. Other identities draw from the same palette; magnitude uses opacity steps of one hue.
- Burn-in: static chrome, app marks and tabs stay low-luminance. Bright colour belongs to changing information, not a permanently filled primary button in the bar.
- Web UI: Geist at the shadcn style's own sizes and weights. Native UI keeps system fonts and Dynamic Type. Portfolio's editorial and printed document typography stays distinct.
- Hosts, ids, times, figures and shortcuts use tabular mono. Trailing values have fixed-width, right-aligned columns. Prose stays proportional and readable, about 65 characters per line.

## Shape and layout

- One 4px `--radius`; each primitive keeps the shape its shadcn style gives it. System navigation and controls stay native on iOS.
- One-line rows. No column-heading labels or counts in headings/tabs. The whole row opens its content; secondary actions use the existing context menu.
- Dividers are separate, straight, inset lines, hidden next to hovered or selected rows. Never use a rounded row's border or shadow as its divider.
- Show each fact once: no value repeated as a chart, a figure and a percentage, and nothing in the bar that the selected row already shows.
- The URL holds the view: selection, pane and range survive a reload, Back and a shared link. Memory holds only transient input such as an open dialog.
- Keep app bars, navigation and pane geometry mounted through loading, updates and errors. Lists and detail regions scroll independently.
- Detail tools use three columns from 1600px: list, trace/waterfall, selected detail at full height. Narrower desktops put detail below the waterfall, its fields in as many columns as fit. On iPhone, push full-screen with native back.
- Empty regions show one faint icon centred in their own container: search for no matches, the app mark for nothing selected. No explanatory title, count or paragraph.
- Deploy ports: stock badges, exposed in `default`, unexposed in `secondary`, at least 7ch wide so a five-digit port is never cut.

## Components and recovery

- Compose the public shadcn `base-mira` primitives in `packages/components-web/src/ui/` as shipped: they stay read-only, `theme.css` sets only tokens, and a call site's `className` only places a primitive, never restyles it. `components.json` selects Phosphor. Refresh through the CLI as `AGENTS.md` describes. Native components mirror their names over `@expo/ui` SwiftUI and take `modifiers` where web components take `className`.
- Phosphor replaces Lucide: regular at 16px and below, light at 20px and above. Keep accessible names on icon controls; hover/focus names unfamiliar kinds. Native system symbols retain native behaviour.
- Every page action lives in the stock `CommandDialog` palette, opened from the search field centred on the page in the bar or ⌘K; the bar holds only controls that choose what the page shows. Command entries always have an icon; shortcuts use `CommandShortcut`.
- Loading uses local Suspense with geometry-matched `ItemListSkeleton` or redacted native `Item` parts. Local session reads show the blank shell; no standalone spinner or fake progress. Pressed controls may show a spinner.
- Retain authorised content through ordinary outages. Beside usable content, a small status-coloured dot and age mark the affected row, tab or pane; hover/focus/tap exposes a few words and an icon retry. Interactive recovery uses a popover, not a button inside a tooltip.
- Do not dump `formatError`, raw causes or agent instructions into alerts. Diagnostics belong in Scope. Stash's on-device search/body read failures use a quiet saved-copy indicator.
- Blocking failures use a compact icon and brief reason in normal text, with a destructive Retry below: no lone dot, hero, duplicate heading or decorated button. The local reader or route boundary owns them. Native readers use `includeFailure: true`; never throw a data failure into React Native.
- Authorisation denial invalidates retained content and palette records until an actual authorised emission. Styling must not weaken that boundary, empty-success handling, stream recovery or cache invalidation.
- Failed mutations remain attached to the action that caused them. Do not hide whether a destructive action committed.

## Motion

Motion explains a change, never delays work. No ornamental or global press scaling. Use the primitive's behaviour and stock curves; frequent keyboard actions need no motion. Native navigation keeps system motion. Reduced motion removes movement while retaining state feedback.

## Artwork and delivery

Canonical app artwork and SVGL software marks remain transparent, never letter placeholders or decorative tiles. Redrawing app artwork requires its own approved brief; do not recolour `icon.svg` as part of a UI pass. Portfolio's handmade coral bolt is never redrawn.

| Asset                                             | Consumer                                                  |
| ------------------------------------------------- | --------------------------------------------------------- |
| Transparent `icon.svg`                            | Favicon, app bar, `/icon`, `/favicon.ico` and MCP clients |
| `app.icon/` with a 1024px transparent pixel layer | Icon Composer; iOS supplies its system treatment          |
| 1024px transparent `icon.png`                     | Native in-app title                                       |
| Whole-cell indexed `public/apple-touch-icon.png`  | Installed web app home screen                             |

`ServerRuntime.layerWeb` owns the standalone manifest and raster icon. Web roots clear the top safe area; scrollers clear the bottom.

The approved Kanagawa pixel-art family is fixed: copy the cell-run SVGs unchanged, retain transparency and `crispEdges`, and scale raster cells only by integers. Touch icons use a 192px render cropped centrally to 180px on `#0d0c0c`; native icon backgrounds use the same colour. No smoothing, recolouring or extra small variants.
