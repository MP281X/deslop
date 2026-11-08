# Deslop

Personal tools for a power user: compact, keyboard-first, fast once learned. Icons, position and colour lead; explanation appears on hover or focus. Remove anything that adds little value.

`packages/components-web/src/theme.css` and `packages/components-mobile/src/theme.ts` own tokens; their drift tests cover both appearances. Product intent belongs in each app's `AGENTS.md`. Lint keeps shadcn call sites to placement; the verification skill's page audit measures what a page shows (one radius, theme colours and font, tabular figures, line length, one-line rows, counts and labels, empty states, untinted selection, command entries, spinners, raw errors, press scaling, Lucide). This file keeps what neither can check.

## Targets

- Desktop: 3440×1440 at 1× on the QD-OLED ultrawide; 1920×1080 on the portable OLED; about 1512×982 on the MacBook. Multi-pane tools fill the screen; a single list keeps a centred reading width.
- iPhone Air: 420×912pt, Dynamic Island and native back navigation. Respect safe areas and Dynamic Type.
- P3 displays throughout. Preserve Kanagawa's original chroma: gamut-independent OKLCH on the web, lossless sRGB equivalents at Expo's native colour boundary. Do not boost saturation.
- Dark uses Kanagawa; light uses neutral white and grey surfaces, never Lotus paper or khaki. Only app and status hues carry colour, darkened to read on white. Validate the appearance actually shown, not an assumed dark-mode default. Printed documents stay light and retain their paper layout.

## Colour and type

- Dragon neutrals: near-black background, one-step neutral selected/hover fill, straight hairlines.
- App identity: Deploy blue, Scope cyan, Gateway pink, Auth slate, Signal violet, Stash amber, Trips orange, OPM ivory. Portfolio keeps its coral bolt.
- Scope sides: server blue, browser pink, iOS amber, CI violet. Deploy machines: dev spring blue, desktop autumn yellow. Kinds use tinted icons, not dots.
- Error red; warning orange. Dots communicate problems and live activity, never health that needs no attention or the kind of a thing. Other identities draw from the same palette; magnitude uses opacity steps of one hue.
- Burn-in: static chrome, app marks and tabs stay low-luminance. Bright colour belongs to changing information, not a permanently filled primary button in the bar.
- Web UI uses the Sera shadcn style: Instrument Serif for the one display heading that names a view, Geist for every control, label and number, and Geist Mono for hosts, ids, times and figures. Component titles keep Sera's uppercase, tracked sans. Native UI keeps system fonts and Dynamic Type. Portfolio's editorial and printed document typography stays distinct.
- Hosts, ids, times, figures and shortcuts in running text and table cells use tabular mono; inside a shadcn component they take its own font. Trailing values have fixed-width, right-aligned columns.

## Shape and layout

- Web surfaces are square: one 0px `--radius`, hairline rules and no decorative shadow. Popups are the only raised surface. A selected row is the `secondary` variant of its button. System navigation and controls stay native on iOS, following Apple's current guidelines as closely as SwiftUI allows: a root list takes the system large title, which collapses inline as it scrolls; no custom title view, bar background or restyled system control. Native tiles use the system's concentric 12pt radius.
- The web masthead is 56px: app mark and serif name, ruled section tabs, one underlined search field centred on the page, then the controls that choose what the page shows. Page headers put a tracked uppercase eyebrow over one serif statement and a short deck. Content uses 24px gutters on a phone, 32px on a desktop, 56px rows on a pointer and 48px on touch.
- A single reading column is 48rem; a standard tool page is 72rem; a full workspace such as Scope fills the viewport. Never stretch a list across an ultrawide.
- The whole row opens its content; secondary actions use the existing context menu.
- Dividers are separate, straight, inset lines, hidden next to hovered or selected rows.
- Show each fact once: no value repeated as a chart, a figure and a percentage, and nothing in the bar that the selected row already shows.
- The URL holds the view: selection, pane and range survive a reload, Back and a shared link. Memory holds only transient input such as an open dialog.
- Keep app bars, navigation and pane geometry mounted through loading, updates and errors. Lists and detail regions scroll independently.
- Detail tools use three columns from 1600px: list, trace/waterfall, selected detail at full height. Narrower desktops put detail below the waterfall, its fields in as many columns as fit. On iPhone, push full-screen with native back.
- Empty regions show one restrained icon, a serif title and one sentence that says what to do next: search for no matches, the app mark for nothing selected. A blocking failure uses an Alert rule with a destructive Retry, never a hero.
- Deploy ports: a port that opens something is a stock small button, whose 12px text reads at a glance, exposed in `default`, exposable in `secondary`; one that can't be exposed is a disabled `ghost` one, so all three share one box. Each is at least 7ch wide so a five-digit port is never cut.

## Components and recovery

- Compose the public shadcn `base-sera` primitives in `packages/components-web/src/ui/` as shipped: they stay read-only and `theme.css` sets tokens and the shell every app shares (a full-height document, list-row dividers, iOS input size). Each control is the primitive made for its job: tabs switch between views, a button runs an action or opens something, a badge only labels. `components.json` selects Phosphor. Refresh through the CLI as `AGENTS.md` describes.
- A call site places a primitive (margin, size, position, flex or grid placement) or picks a variant; it never repaints it. A new look is a variant on the shipped primitive, documented here first. Native components mirror their names over `@expo/ui` SwiftUI and take `modifiers` where web components take `className`.
- Phosphor icons: regular at 16px and below, light at 20px and above; hover/focus names unfamiliar kinds. Native system symbols retain native behaviour.
- Every page action lives in the stock `CommandDialog` palette, opened from the underlined search field in the masthead or ⌘K; the bar holds only controls that choose what the page shows.
- Loading uses local Suspense with geometry-matched `ItemListSkeleton` or redacted native `Item` parts. Local session reads show the blank shell.
- Retain authorised content through ordinary outages. Beside usable content, a small status-coloured dot and age mark the affected row, tab or pane; hover/focus/tap exposes a few words and an icon retry. Interactive recovery uses a popover, not a button inside a tooltip.
- Diagnostics belong in Scope, not in alerts. Stash's on-device search/body read failures use a quiet saved-copy indicator.
- Blocking failures use a compact icon and brief reason in normal text, with a destructive Retry below: no lone dot, hero, duplicate heading or decorated button. The local reader or route boundary owns them. Native readers use `includeFailure: true`; never throw a data failure into React Native.
- Authorisation denial invalidates retained content and palette records until an actual authorised emission. Styling must not weaken that boundary, empty-success handling, stream recovery or cache invalidation.
- Failed mutations remain attached to the action that caused them. Do not hide whether a destructive action committed.

## Motion

Motion explains a change, never delays work. Use the primitive's behaviour and stock curves; frequent keyboard actions need no motion. Native navigation keeps system motion. Reduced motion removes movement while retaining state feedback.

## Artwork and delivery

Canonical app artwork and SVGL software marks remain transparent, never letter placeholders or decorative tiles. Redrawing app artwork requires its own approved brief; do not recolour `icon.svg` as part of a UI pass. Portfolio's handmade coral bolt is never redrawn.

| Asset                                             | Consumer                                                  |
| ------------------------------------------------- | --------------------------------------------------------- |
| Transparent `icon.svg`                            | Favicon, app bar, `/icon`, `/favicon.ico` and MCP clients |
| `app.icon/` with a 1024px transparent pixel layer | Icon Composer; iOS supplies its system treatment          |
| 1024px transparent `icon.png`                     | Native sign-in screen                                     |
| Whole-cell indexed `public/apple-touch-icon.png`  | Installed web app home screen                             |

`ServerRuntime.layerWeb` owns the standalone manifest and raster icon. Web roots clear the top safe area; scrollers clear the bottom.

The approved Kanagawa pixel-art family is fixed: copy the cell-run SVGs unchanged, retain transparency and `crispEdges`, and scale raster cells only by integers. Touch icons use a 192px render cropped centrally to 180px on `#0d0c0c`; native icon backgrounds use the same colour. No smoothing, recolouring or extra small variants.
