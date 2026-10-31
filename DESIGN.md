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
  # The icon tile and the icon's pixel shadow.
  icon-tile: '#fafafa'
  icon-shadow: '#0a0a0a'
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

## Layout

- **Rows, not cards.** Hairline rows: a leading mark, a title, one muted line, a trailing status or action.
- **One column** up to `page`, forms up to `form`; list-and-detail tools split into two panes. 8px inside a group, 16px between groups, 24–32px between sections.
- **iOS.** Inline titles, plain lists, bottom search.

## Elevation & Depth

A tonal step and a hairline, never a shadow, gradient or glow. On iOS, Liquid Glass is for navigation and controls only.

## Shapes

4px controls, 6px surfaces, 10px overlays, full circles for dots and avatars. iOS keeps the system's shapes.

## Components

- **Web.** shadcn `base-mira` from `packages/components-web/src/ui/`, theme tokens only.
- **iOS.** `@expo/ui` SwiftUI primitives; system controls stay native.
- **Favicons** are the source's own, never a letter tile.

## Icons

One PNG is the iOS icon and the favicon: pixel art like the portfolio bolt, 18×18 cells on a 24×24 `icon-tile`, 1024px with nearest-neighbour scaling. Fill is the app's hue, one `icon-shadow` cell right of every run, detail as tile cut-outs or a 62% darker fill. opm keeps its Saitama face; the bolt's loose pixels take the other apps' hues.

## Do's and Don'ts

- Don't add a card per section, a colored side stripe or a color per item.
- Don't use a hue beyond the app's primary, warning and error; the portfolio's visitor cursors are the one exception.
