---
version: alpha
name: Deslop
description: Every Deslop app, web and iOS. Dark first, grayscale with hairlines, one Flexoki hue per app, pixel-art icons. Tokens are dark; each has a light- twin.
colors:
  # Neutrals, dark appearance.
  background: '#0a0a0a'
  foreground: '#ededed'
  card: '#111111'
  popover: '#141414'
  secondary: '#1c1c1c'
  muted: '#161616'
  muted-foreground: '#9a9a9a'
  accent: '#1c1c1c'
  border: '#222222'
  input: '#2a2a2a'
  primary: '#da702c'
  primary-foreground: '#0a0a0a'
  # Hues, dark appearance (Flexoki 400). Each app takes one as its primary; red is only for errors.
  red: '#d14d41'
  orange: '#da702c'
  yellow: '#d0a215'
  green: '#879a39'
  cyan: '#3aa99f'
  blue: '#4385be'
  purple: '#8b7ec8'
  magenta: '#ce5d97'
  destructive: '#d14d41'
  warning: '#d0a215'
  # Neutrals, light appearance.
  light-background: '#ffffff'
  light-foreground: '#0a0a0a'
  light-card: '#fafafa'
  light-popover: '#ffffff'
  light-secondary: '#f2f2f2'
  light-muted: '#f5f5f5'
  light-muted-foreground: '#666666'
  light-accent: '#f0f0f0'
  light-border: '#e5e5e5'
  light-input: '#d9d9d9'
  light-primary: '#bc5215'
  light-primary-foreground: '#ffffff'
  # Hues, light appearance (Flexoki 600).
  light-red: '#af3029'
  light-orange: '#bc5215'
  light-yellow: '#ad8301'
  light-green: '#66800b'
  light-cyan: '#24837b'
  light-blue: '#205ea6'
  light-purple: '#5e409d'
  light-magenta: '#a02f6f'
  light-destructive: '#af3029'
  light-warning: '#ad8301'
  # The installed icons' tile and the icon's pixel shadow, the same in both appearances.
  icon-tile: '#fafafa'
  icon-shadow: '#0a0a0a'
  light-icon-tile: '#fafafa'
  light-icon-shadow: '#0a0a0a'
typography:
  title:
    fontFamily: Geist
    fontSize: 20px
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: -0.02em
  body:
    fontFamily: Geist
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: Geist
    fontSize: 12px
    fontWeight: 500
    lineHeight: 1.6
  data:
    fontFamily: Geist Mono
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.5
  ios-title:
    fontFamily: SF Pro
    fontSize: 17px
    fontWeight: 600
  ios-row:
    fontFamily: SF Pro
    fontSize: 15px
    fontWeight: 600
  ios-body:
    fontFamily: SF Pro
    fontSize: 15px
    fontWeight: 400
  ios-detail:
    fontFamily: SF Pro
    fontSize: 13px
    fontWeight: 400
  ios-data:
    fontFamily: SF Mono
    fontSize: 13px
    fontWeight: 400
  ios-caption:
    fontFamily: SF Pro
    fontSize: 12px
    fontWeight: 400
rounded:
  sm: 2px
  md: 4px
  lg: 6px
  xl: 10px
  full: 9999px
spacing:
  1: 4px
  2: 8px
  3: 12px
  4: 16px
  6: 24px
  8: 32px
  16: 64px
  page: 768px
  form: 576px
components:
  button-primary:
    backgroundColor: '{colors.primary}'
    textColor: '{colors.primary-foreground}'
    typography: '{typography.label}'
    rounded: '{rounded.md}'
    height: 28px
    padding: 0 8px
  button-outline:
    backgroundColor: '{colors.muted}'
    textColor: '{colors.foreground}'
    typography: '{typography.label}'
    rounded: '{rounded.md}'
    height: 28px
    padding: 0 8px
  input:
    backgroundColor: '{colors.muted}'
    textColor: '{colors.foreground}'
    typography: '{typography.label}'
    rounded: '{rounded.md}'
    height: 28px
    padding: 0 8px
  list-row:
    backgroundColor: '{colors.background}'
    textColor: '{colors.foreground}'
    typography: '{typography.body}'
    padding: 10px 4px
  status-dot:
    backgroundColor: '{colors.primary}'
    size: 7px
    rounded: '{rounded.full}'
  app-icon:
    backgroundColor: '{colors.icon-tile}'
    textColor: '{colors.icon-shadow}'
    size: 1024px
---

# Deslop

The tokens above are the contract. `packages/components-web/src/theme.css` and `packages/components-mobile/src/theme.ts` repeat them, and their tests fail on drift.

## Overview

Fast tools, not consumer or enterprise apps: Linear, Vercel, Executor, T3 Code. Dark first; light covers every token but is never designed first.

## Colors

- **Neutrals.** `background` is the page. `card` and `popover` only for what floats or groups a few controls; `secondary`, `muted` and `accent` fill chips, inputs and hover; `border` draws hairlines, `input` strokes fields.
- **One hue per app**, from the table below: the one action per view, focus, selection and anything live. The web points `--primary` at it in the app's `styles.css`; iOS exports `primary` from `lib/utils.ts`. A new app takes an unused hue, or orange.
- **Status.** Live is the primary. Warning is yellow and error red, each with a word or icon. Off is muted: a hollow dot when switched off, a filled one for quiet states. White on light yellow only for large or bold labels.
- **Deploy machine identity.** Dev uses blue, desktop purple, consistently in device icons, charts, swatches and live dots. Its stacked charts are the one place a hue steps by opacity: the heaviest app strongest, fading by size.
- **Scope side identity.** Where a span ran: server blue, web magenta, iOS green, consistently in an operation's device icon, a span's bar and the side named where a trace crosses over.

| App       | Hue     |
| --------- | ------- |
| portfolio | orange  |
| opm       | orange  |
| auth      | orange  |
| deploy    | blue    |
| gateway   | purple  |
| scope     | cyan    |
| signal    | magenta |
| stash     | yellow  |
| trips     | blue    |

## Typography

Geist on the web, SF Pro on iOS at Dynamic Type sizes through the `text` tokens in `theme.ts`, nothing bundled. Machine text (hosts, ids, times, counts, codes, shortcuts) is Geist Mono or SF Mono; prose never is. Sentence case, no uppercase or letter-spaced labels.

- **Numbers that change** use tabular figures, so they don't jitter.
- **Times** read relative for a week ("3h ago"), then as a date; counts pluralize through `Intl.PluralRules`.
- **Prose** stops at about 65 characters a line.

## Layout

- **Rows, not cards.** One-line hairline rows: a leading mark, a title, its muted detail, then trailing figures, status and action in shared columns. A row with more to show opens beneath itself: the whole row opens it, its chevron at the right.
- **What needs you leads.** Rows that need the user sort first, their reason taking the muted detail's place in the state's colour, a longer error on its own line beneath; no label, divider or gap sets them apart. A row shows a button only for a fix the user can make; its other actions sit in its context menu (right-click, long press), never behind a ⋯ button.
- **One column** up to `page`, forms up to `form`; list-and-detail tools split into two panes. 8px inside a group, 16px between groups, 24–32px between sections.
- **iOS.** Inline titles, plain lists, bottom search.
- **App bars.** The app icon and name lead on the web and take the title's place, centered and without a glass button, on iOS; detail screens keep their native back navigation. Signal's spectator world uses map controls instead of an app bar.
- **The web app bar is the page header**: name, section tabs, the command field, the page's action (at most one quieter outline action beside it), the account; no heading below it. The command field narrows the page's rows and lists the actions that match, ⌘K focuses it, and on a phone it opens from a search button over the bar. Each app stays its own; no bar links to another app.
- **Row alignment.** Center leading marks and trailing actions against the whole row, including wrapped details. Rows with inline process trees align both marks to the parent title; `ItemMedia` opts into `data-align="start"`. Stash reserves a 64pt media square even without a preview, using the source mark as its fallback.
- **List endings.** A closing hairline marks the last row; installed web apps keep 16px plus the home-indicator inset below it.

## Elevation & Depth

A tonal step and a hairline, never a shadow, gradient or glow. On iOS, Liquid Glass is for navigation and controls only.

## Shapes

4px controls, 2px badges, 6px surfaces, menus, popovers and dialogs, full circles for dots and avatars; no pills. iOS keeps the system's shapes.

## Components

One vocabulary on both platforms: a row is an `Item` on iOS and a one-line hairline row on the web, a blank state an `Empty`, a filter a `ToggleGroup`, a status a `StatusDot`.

- **Web.** Every shadcn `base-mira` component in `packages/components-web/src/ui/`, as the CLI writes it apart from the fixes `AGENTS.md` names; house rules such as the press scale live in `theme.css`. Beside it: `StatusDot`, `ItemListSkeleton` (one-line rows loading), `SignIn` and `ResultError`. Apps compose these before writing their own markup.
- **iOS.** `packages/components-mobile/src/ui/` carries the same names and parts over `@expo/ui` SwiftUI (`Item`, `ItemMedia`, `ItemContent`, `ItemTitle`, `ItemDescription`, `ItemActions`, `ItemGroup`, `Empty…`, `ToggleGroup`, `Spinner`), taking `modifiers` where the web takes `className`. System controls stay native.
- **Tokens only.** shadcn's lint keeps web classes on the theme; `swiftui-theme-values` does the same for SwiftUI: spacing from `space`, type from `text` or a Dynamic Type style, colours from `colors`.
- **App and process marks** are transparent, never tiles or letter placeholders, in every app and for every server's own favicon. Use canonical Deslop artwork and software marks installed through SVGL's shadcn registry; tiles belong only to installed home-screen and iOS icons, which must be opaque.
- **Signal controls.** Quiet popover buttons carry provider-coloured marks, matching their world coverage. One top model filter scopes the thread; the inspector header has a bottom hairline. Entity details and the thread remain visible together.
- **Loading.** The shell (app bar, headings, filters) renders at once, and data that is on its way shows as a skeleton shaped like it: `ItemListSkeleton` on the web, `ItemGroupSkeleton` (SwiftUI's placeholder redaction) on iOS. A skeleton is a Suspense fallback (`useAtomSuspense` with `includeFailure`), never an `onInitial` branch: React keeps a shown fallback at least 300ms, so it never blinks. Local work, like reading the saved session, shows the empty shell and no skeleton. A refresh keeps the current data, dimmed. A spinner only sits inside a control the user pressed, never alone on a page; no client-side caches to hide loading.
- **Errors.** A page that cannot load shows the route's error boundary in its place, with a retry; nothing else catches a render or load failure. A page that loads only in part keeps what it has, under an `Alert` naming what is missing. A failed action says why where it was asked: under its field, in the dialog that stays open, or beneath the row that ran it (Layout, What needs you leads), through `ResultError`. Only an action with no such place, from the app bar, the account menu or a grid's column head, raises a toast; on iOS, a failed swipe or menu action raises the system alert. Never an error line at a page's foot.
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

Every web app installs as its own app: `ServerRuntime.layerManifest` serves a standalone, dark manifest with both icons, the root keeps clear of the status bar with `safe-area`, and a scrolling page runs under the home indicator with `pb-safe` so its end scrolls clear.

## Do's and Don'ts

- Don't add a card per section, a colored side stripe or a color per item.
- Don't use a hue beyond the app's primary, warning and error; exceptions are portfolio visitor cursors and Signal's semantic team identities on the world, authors and event labels. Team colour does not fill whole message cards.
