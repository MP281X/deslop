# Deslop

`packages/components-web/src/theme.css` and `packages/components-mobile/src/theme.ts` are the token contract; their tests fail on drift.

## Overview

Fast tools, not consumer or enterprise apps: Linear, Vercel, Executor, T3 Code. Dark first; light covers every token but is never designed first.

## Colors

- **Neutrals.** `background` is the page. `card` and `popover` only for what floats or groups a few controls; `secondary`, `muted` and `accent` fill chips, inputs and hover; `border` draws hairlines, `input` strokes fields.
- **One hue per app**: the one action per view, focus, selection and anything live. Its only owner is `--primary` in the app's `styles.css` on the web, or `primary` in `lib/utils.ts` on iOS. A new app takes an unused hue, or orange.
- **Status.** Live is the primary. Warning is yellow and error red, each with a word or icon. Off is muted: a hollow dot when switched off, a filled one for quiet states. White on light yellow only for large or bold labels.
- **Deploy machine identity.** Dev uses blue, desktop purple, consistently in device icons, charts, swatches and live dots. Its stacked charts are the one place a hue steps by opacity: the heaviest app strongest, fading by size.
- **Scope side identity.** Where a span ran: server blue, web magenta, iOS green, CI purple, consistently in an operation's device icon, a span's bar and the side named where a trace crosses over.
- Portfolio visitor cursors and Signal team identities may use the palette's other hues; team colour never fills message cards.

## Typography

Bundled Geist on the web; system SF Pro on iOS at Dynamic Type sizes through `theme.ts`. Portfolio bundles IBM Plex for its editorial voice. Machine text (hosts, ids, times, counts, codes, shortcuts) is mono; prose never is. Sentence case, no uppercase or letter-spaced labels.

- **Numbers that change** use tabular figures, so they don't jitter.
- **Display.** The Portfolio's hero sits above the product titles: 36/48px. The Portfolio is the one editorial exception: its mono role and lowercase mono section labels are its own voice; everything else follows the scale.
- **Times** read relative for a week ("3h ago"), then as a date; counts pluralize through `Intl.PluralRules`.
- **Prose** stops at about 65 characters a line.

## Layout

- **Rows, not cards.** One-line hairline rows: a leading mark, a title, its muted detail, then trailing figures, status and action in shared columns. A row with more to show opens beneath itself: the whole row opens it, its chevron at the right.
- **What needs you leads.** Rows that need the user sort first, their reason taking the muted detail's place in the state's colour, a longer error on its own line beneath; no label, divider or gap sets them apart. A row shows a button only for a fix the user can make; its other actions sit in its context menu (right-click, long press), never behind a ⋯ button.
- **One column** through `Page` (`max-w-3xl`); list-and-detail tools split only when each pane remains readable. 8px inside a group, 16px between groups, 24–32px between sections.
- **iOS.** Inline titles, plain lists, bottom search.
- **App bars.** The app icon and name lead on the web and take the title's place, centered and without a glass button, on iOS; detail screens keep their native back navigation. Signal's spectator world uses map controls instead of an app bar.
- **The web app bar is the page header**: name, section tabs, the command field, the page's action (at most one quieter outline action beside it), the account; no heading below it. The command field narrows the page's rows and lists the actions that match, ⌘K focuses it, and on a phone it opens from a search button over the bar. Each app stays its own; no bar links to another app.
- **Row alignment.** Center leading marks and trailing actions against the whole row, including wrapped details; inline process trees align marks to the parent title. Stash reserves a 64pt media square even without a preview, using the source mark as its fallback. OPM chapters show a cover, two lines and a reading disc, not an x/y counter.
- **List endings.** A closing hairline marks the last row; `pb-safe-bottom` clears the installed web app's home indicator.

## Elevation & Depth

Use the primitive's theme elevation: tonal surfaces and hairlines, no added decorative shadow, gradient or glow. On iOS, Liquid Glass is for navigation and controls only.

## Shapes

Use the theme's radius scale, full circles for dots and avatars. iOS keeps the system's shapes.

## Components

One vocabulary on both platforms: a row is an `Item` on iOS and a one-line hairline row on the web, a blank state an `Empty`, a filter a `ToggleGroup`, a status a `StatusDot`.

- **Web.** Every shadcn `base-mira` component in `packages/components-web/src/ui/`, as the CLI writes it apart from the fixes `AGENTS.md` names; house rules such as the press scale live in `theme.css`. Beside it: `StatusDot`, `ItemListSkeleton` (one-line rows loading), `SignIn` and `ResultError`. Apps compose these before writing their own markup.
- **iOS.** `packages/components-mobile/src/ui/` carries the same names and parts over `@expo/ui` SwiftUI (`Item`, `ItemMedia`, `ItemContent`, `ItemTitle`, `ItemDescription`, `ItemActions`, `ItemGroup`, `Empty…`, `ToggleGroup`, `Spinner`), taking `modifiers` where the web takes `className`. System controls stay native.
- **Tokens only.** shadcn's lint keeps web classes on the theme; `swiftui-theme-values` does the same for SwiftUI: spacing from `space`, type from `text` or a Dynamic Type style, colours from `colors`.
- **App and process marks** are transparent, never tiles or letter placeholders, in every app and for every server's own favicon. Use canonical Deslop artwork and software marks installed through SVGL's shadcn registry; tiles belong only to installed home-screen and iOS icons, which must be opaque.
- **Signal controls.** Quiet popover buttons carry provider-coloured marks, matching their world coverage. One top model filter scopes the thread; the inspector header has a bottom hairline. Entity details and the thread remain visible together.
- **Loading.** Keep the shell (app bar, headings, filters) mounted. Suspend data readers beneath it with shape-matched fallbacks: `ItemListSkeleton` on the web, redacted `ItemGroupSkeleton` on iOS. Local session reads show the blank shell, not a flashing skeleton. Refreshes retain current data. Spinners belong only inside a pressed control; on-device saved lists support offline reading, not fake loading progress.
- **Errors.** Web pages use the route error boundary and a retry when no usable content remains. Native readers use `includeFailure: true` to render `FailureScreen` instead of throwing into React Native. Partial failures retain available content with an `Alert` and a local retry. Failed actions explain why where they were asked, through `ResultError`; only actions without such a place raise a toast (a system alert for native swipe/menu actions). Never an error line at a page's foot.
- **Lone states.** Whatever stands alone on a page or panel (nothing yet, nothing matches, expired, continuing, waiting for someone) is an `Empty`, with its title, an optional description and at most one way out, never a bare paragraph; `Page` centres it on the web, and the iOS `Empty` centres itself.
- **Copy.** Headings, labels and errors only; no subtitle restating what the page already shows.
- **Mobile gestures.** Apps pan instead of zooming; viewport metadata caps scale and shared controls use 16px text on coarse pointers to prevent focus zoom. Browsers may override zoom restrictions for accessibility.

## Motion

Motion marks a change the user caused or should notice, and never holds content back. The curves are `--ease-out`, `--ease-in-out` and `--ease-drawer` in `theme.css`.

- **Gate by frequency.** Keyboard actions and anything used a hundred times a day: none. Tens of times a day (press, hover, list navigation): under 150ms or none. Occasional (dialogs, sheets, toasts): standard. Rare (first run, success): may delight. Each animation names its purpose: feedback, where something came from, a state change, or a jump it smooths.
- **Ingredients.** `transform`, `opacity` and `clip-path` only, never `transition: all`; two exceptions, since nothing else can do them: a row entering a list grows its grid row with its opacity, and a chart's axis eases through a registered custom property. Nothing grows from `scale(0)`: start at 0.95 with opacity 0. Popovers grow from their trigger, dialogs from the centre. Transitions, not keyframes, for anything that can retrigger. Exit faster than enter.
- **Curves and time.** `ease-out` to enter or leave, `ease-in-out` to move on screen, linear only for progress, never `ease-in`. Press 100–160ms, popovers 125–200ms, menus 150–250ms, dialogs and sheets 200–300ms.
- **Press and hover.** Pressables scale to 0.97; hover motion only under `(hover: hover) and (pointer: fine)`.
- **iOS.** Navigation, sheets and tab bars keep the system's motion, and tabs never slide. What a finger moves follows a spring (damping 1, or 0.8 after a flick). One haptic per committed action, on the same frame as its visual, never on its own.
- **Reduced motion** drops movement and keeps fades and colour.
- **Each app's own.** One signature motion, only when its data changes:

| App     | Motion                                                                         |
| ------- | ------------------------------------------------------------------------------ |
| Trips   | a changed gate, platform or time flips in like a departures board              |
| Scope   | a trace that arrives grows into its open operation                             |
| Auth    | an answer settles out of a blur; a code no sign-in has shakes once             |
| Gateway | a server's dot dims for a moment on each tool call, like a switch port's light |
| Stash   | the share sheet's tick draws itself in, with one success haptic                |
| Signal  | units walk at an even pace across each frame, and cut on a timeline jump       |

## Icons

Each app is one real object in isometric pixel art, drawn by one renderer so the set reads as a family: 64 cells, 2:1 pixel lines, the object inside cells 7–56 with about 1,100–1,300 filled cells, light from the upper left. Every face takes the same step of its material: top 300, left 400, right 600, with Flexoki 200 on the lit top front edges; steel and near-black follow the same ramp. One `icon-shadow` outline and one footprint shadow in black at 35%. A lock (auth), a torii (gateway), a monitor with a trace waterfall (scope), a sawtooth factory with lit windows (signal), a book with a label and ribbon (stash), a suitcase (trips), a manga volume standing up with Saitama's face as its cover and its page block between the covers (opm), a two-port steel appliance with a diamond inset, side vents and a blue status strip (deploy). The one exception is the portfolio bolt, the user's own hand-made mark, kept exactly as drawn: flat, coral with black edges and black loose pixels on an 18-cell grid, never redrawn.

Construct icons on an explicit 64×64 grid: 2:1 diagonals are stepped cells, not smooth polygons with `crispEdges`. Encode the approved grid as equal-color, axis-aligned SVG cell runs; derive tiled, transparent and required raster variants from that same artwork. A raster stays only where a consumer needs one, at the smallest size and format it accepts.

| File                                     | Format                                                                                                      | Used as                                                                                                               |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `icon.svg`                               | SVG, transparent                                                                                            | favicon, the web app bar, the server's `/icon` and `/favicon.ico` for Auth, Gateway and MCP clients                   |
| `app.icon/` (iOS apps)                   | Icon Composer, an SVG layer sized `width`/`height` 1024, since Icon Composer places a layer at its own size | the iOS icon: the artwork on `icon-tile`, in every appearance, so it matches the installed web apps; iOS derives tint |
| `icon.png` (iOS apps)                    | indexed PNG, 1024px                                                                                         | the in-app title, which needs a raster                                                                                |
| `public/apple-touch-icon.png` (web apps) | indexed PNG, ~512px, a whole multiple of the cells                                                          | the home-screen icon of the installed web app, which iOS wants as a raster                                            |

`ServerRuntime.layerWeb` serves each web app's standalone manifest and raster home-screen icon. Roots use `pt-safe-top`; scrolling pages use `pb-safe-bottom`.
