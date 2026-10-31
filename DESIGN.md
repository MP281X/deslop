---
version: alpha
name: Deslop
description: One design system for every Deslop app, on the web and on iOS. Near-black and dark first, grayscale with hairlines, dense rows, one primary hue per app from a hand-tuned set, Geist on the web, SF Pro on iOS, and pixel-art app icons. Tokens are the dark appearance; each has a light- twin.
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

The visual system of every Deslop app. Its YAML tokens are the contract: `packages/components-web/src/theme.css` and `packages/components-mobile/src/theme.ts` carry the same values, and their tests fail when either drifts from this file.

## Overview

Fast tools first: Linear, Vercel, Executor and T3 Code are the references, not consumer or enterprise apps.

- **Dark first.** Near-black `#0a0a0a`, hairline borders, no cards per section and no shadows. Light mode exists for every token and is never designed first.
- **Grayscale ranks, one hue acts.** Text, muted text and hairlines carry hierarchy. The app's primary marks the one action per view, focus, selection and anything live right now.
- **Dense and quiet.** 28px controls, 12–14px text on the web, system sizes on iOS, hairline rows instead of boxes.
- **Machine text is mono.** Hosts, ids, times, counts, codes and keyboard shortcuts set in Geist Mono or SF Mono; prose never does.

## Colors

### Neutrals

`background` is the page; `card` and `popover` sit on it only for something that floats or groups a few controls, never for a page section. `secondary`, `muted` and `accent` are fills for chips, inputs and hover, not page backgrounds. `border` draws every hairline; `input` strokes fields.

### One hue per app

Every primary comes from the same hand-tuned set (Flexoki 400 in dark, 600 in light), so no app looks louder than another. An app's web stylesheet points `--primary` at its hue; an iOS app exports `primary` from its `lib/utils.ts` and passes it to the shared components that tint.

| App       | Hue     | Dark      | Light     |
| --------- | ------- | --------- | --------- |
| portfolio | orange  | `#da702c` | `#bc5215` |
| opm       | orange  | `#da702c` | `#bc5215` |
| auth      | green   | `#879a39` | `#66800b` |
| gateway   | purple  | `#8b7ec8` | `#5e409d` |
| scope     | cyan    | `#3aa99f` | `#24837b` |
| signal    | magenta | `#ce5d97` | `#a02f6f` |
| stash     | yellow  | `#d0a215` | `#ad8301` |
| trips     | blue    | `#4385be` | `#205ea6` |

A new app takes a hue no app uses yet, or orange.

### Status

- **Live** is the app's primary: connected, boarding, on time, now, reading. One hue means "happening, as planned".
- **Warning** is yellow, **error** is red; both pair with a word or an icon, never color alone.
- **Off** is muted text: a hollow dot for something switched off (not connected), a muted dot for a quiet state (booked, past).
- **Light mode** keeps white text on every primary; on yellow it reaches only the 3:1 of large text, so it stays on large or bold labels.

## Typography

- **Web.** Geist for interface and prose, Geist Mono for machine text. Titles 20px semibold with -0.02em tracking; body 14px; labels and controls 12px medium; data 12px mono. Sentence case everywhere: no uppercase, no letter-spaced labels.
- **iOS.** SF Pro and SF Mono through font design at Dynamic Type sizes, so nothing is bundled: inline navigation titles at 17pt semibold, row titles 15pt semibold, detail 13pt, data 13pt SF Mono, captions 12pt. The `text` tokens in `packages/components-mobile/src/theme.ts` name these; screens use them rather than sizes.

## Layout

- **Rows, not cards.** Lists are hairline-separated rows of about 40px on the web and system list rows on iOS: a leading mark (favicon, countdown, dot), a title, one muted detail line, and a trailing status or action.
- **One column.** Web pages sit under the shared app bar in a column up to `page` (768px), sign-in and forms up to `form` (576px), with 16–24px padding; tools with a list and a detail split into a fixed list pane and a detail pane.
- **Rhythm.** 4px steps: 8px inside a group, 16px between groups, 24–32px between sections.
- **iOS** uses inline navigation titles, `listStyle('plain')`, bottom-bar search and glass controls in the toolbar.

## Elevation & Depth

Depth is a tonal step and a hairline, never a drop shadow. Dialogs and menus use `popover`. On iOS, Liquid Glass belongs to navigation and controls only; content never sits on glass.

## Shapes

`--radius` is 6px: 4px controls, 6px surfaces, 10px large overlays, full circles for dots and avatars. iOS keeps the system's shapes.

## Components

- **Web.** shadcn `base-mira` components from `packages/components-web/src/ui/`, added with `vpx shadcn@latest add`; pages compose them with theme tokens only, no raw colors or arbitrary values.
- **iOS.** SwiftUI primitives from `@expo/ui` (navigation, toolbars, search, lists, menus, swipe actions, sheets, SF Symbols) with the theme's colors and `text` tokens; system controls stay native.
- **Favicons** are real: a server, site or source shows its own favicon, never a letter tile or an icon pack glyph.

## Icons

Every app icon is pixel art in the style of the portfolio bolt:

- **Grid.** 18×18 cells centered on a 24×24 tile, so 3 cells of margin on each side; exported at 1024×1024 with nearest-neighbour scaling, no transparency.
- **Tile** `icon-tile`; **fill** the app's dark hue; **shadow** one `icon-shadow` cell to the right of every horizontal run; **detail** in `icon-tile` cut-outs or a 62% darker fill.
- **One idea per glyph.** Key (auth), torii gate (gateway), waterfall bars (scope), factory (signal), bookmark with a star (stash), ticket with a plane (trips). The portfolio bolt's loose pixels take the other apps' hues.
- **Exception.** opm keeps its Saitama face.

The same PNG is the iOS app icon and the web favicon.

## Do's and Don'ts

- Do keep one primary action per view, in the app's hue.
- Do put hosts, ids, times and counts in mono.
- Do separate rows with hairlines and group with spacing.
- Don't add a card per section, a colored side stripe, a gradient, a glow or a shadow.
- Don't color a tile per item or use a hue that isn't the app's primary, warning or error; the portfolio's visitor cursors, which take any app hue, are the one exception.
- Don't uppercase or letter-space labels.
- Don't bundle fonts on iOS or set prose in mono.
