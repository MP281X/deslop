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
  # The icon tile and the icon's pixel shadow, the same in both appearances; favicons sit on the tile too.
  icon-tile: '#fafafa'
  icon-shadow: '#0a0a0a'
  light-icon-tile: '#fafafa'
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

| App       | Hue     |
| --------- | ------- |
| portfolio | orange  |
| opm       | orange  |
| auth      | orange  |
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

- **Rows, not cards.** Hairline rows: a leading mark, a title, one muted line, a trailing status or action.
- **One column** up to `page`, forms up to `form`; list-and-detail tools split into two panes. 8px inside a group, 16px between groups, 24–32px between sections.
- **iOS.** Inline titles, plain lists, bottom search.

## Elevation & Depth

A tonal step and a hairline, never a shadow, gradient or glow. On iOS, Liquid Glass is for navigation and controls only.

## Shapes

4px controls, 6px surfaces, 10px overlays, full circles for dots and avatars. iOS keeps the system's shapes.

## Components

One vocabulary on both platforms: a row is an `Item`, a blank state an `Empty`, a filter a `ToggleGroup`, a status a `StatusDot`.

- **Web.** shadcn `base-mira` in `packages/components-web/src/ui/`, exactly as the CLI writes it; house rules such as the press scale live in `theme.css`. Beside it: `StatusDot`, `ItemList` (hairline rows), `SignIn` and `ResultError`. Apps compose these before writing their own markup.
- **iOS.** `packages/components-mobile/src/ui/` carries the same names and parts over `@expo/ui` SwiftUI (`Item`, `ItemMedia`, `ItemContent`, `ItemTitle`, `ItemDescription`, `ItemActions`, `ItemGroup`, `Empty…`, `ToggleGroup`, `Spinner`), taking `modifiers` where the web takes `className`. System controls stay native.
- **Tokens only.** shadcn's lint keeps web classes on the theme; `swiftui-theme-values` does the same for SwiftUI: spacing from `space`, type from `text` or a Dynamic Type style, colours from `colors`.
- **Favicons** are the source's own, on the `icon-tile`, never a letter tile.
- **Loading.** The shell (app bar, headings, filters) renders at once, and data that is on its way shows as a skeleton shaped like it: `ItemListSkeleton` on the web, `ItemGroupSkeleton` (SwiftUI's placeholder redaction) on iOS. A skeleton is a Suspense fallback (`useAtomSuspense` with `includeFailure`), never an `onInitial` branch: React keeps a shown fallback at least 300ms, so it never blinks. Local work, like reading the saved session, shows the empty shell and no skeleton. A refresh keeps the current data, dimmed. A spinner only sits inside a control the user pressed, never alone on a page; no client-side caches to hide loading.
- **Copy.** Headings, labels and errors only; no subtitle restating what the page already shows.

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
| Scope   | the waterfall eases to a new trace's scale; traces a refresh adds grow in      |
| Auth    | an answer settles out of a blur; a code no sign-in has shakes once             |
| Gateway | a server's dot dims for a moment on each tool call, like a switch port's light |
| Stash   | the share sheet's tick draws itself in, with one success haptic                |
| Signal  | units walk at an even pace across each frame, and cut on a timeline jump       |

## Icons

Each app is one real object in isometric pixel art: 64 cells, 2:1 pixel lines, three tones per material (Flexoki 300, 400 and 600 of the app's hue, steel, near-black), light catching the top front edges, a footprint shadow and an `icon-shadow` outline, with one lit part. A lock (auth), a torii (gateway), a monitor with a trace waterfall (scope), a sawtooth factory (signal), a book with a ribbon (stash), a suitcase (trips), a manga volume standing up with Saitama's face as its cover and its page block between the covers (opm). Exception: the portfolio bolt stays flat, its loose pixels in the other apps' hues.

Pixel art ships as SVG, one cell per unit with `crispEdges`, so it stays sharp at any size in a fraction of a PNG's bytes. A raster stays only where a consumer needs one, at the smallest size and format it accepts.

| File                                     | Format                                                                                                      | Used as                                                                                                             |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `icon.svg`                               | SVG on `icon-tile`                                                                                          | favicon; the server's `/icon` for Auth's app list and MCP clients                                                   |
| `icon-dark.svg`                          | SVG, transparent                                                                                            | dark favicon, the web app bar                                                                                       |
| `app.icon/` (iOS apps)                   | Icon Composer, an SVG layer sized `width`/`height` 1024, since Icon Composer places a layer at its own size | the iOS icon: `icon.svg` with its tile, in every appearance, so it matches the installed web apps; iOS derives tint |
| `icon.png` (iOS apps)                    | indexed PNG, 1024px                                                                                         | the in-app title, which needs a raster                                                                              |
| `public/apple-touch-icon.png` (web apps) | indexed PNG, ~512px, a whole multiple of the cells                                                          | the home-screen icon of the installed web app, which iOS wants as a raster                                          |

Every web app installs as its own app: `ServerRuntime.layerManifest` serves a standalone, dark manifest with both icons, the root keeps clear of the status bar with `safe-area`, and a scrolling page runs under the home indicator with `pb-safe` so its end scrolls clear.

## Do's and Don'ts

- Don't add a card per section, a colored side stripe or a color per item.
- Don't use a hue beyond the app's primary, warning and error; the portfolio's visitor cursors are the one exception.
