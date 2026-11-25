# Components mobile

- Name a list screen inline in the navigation bar (`ListToolbar`), not with a large title: the user decided this on 20 November 2026, an exception to the root rule "No page titles".
- A screen holding typed, unsaved text tells the updater with `useAtomMount(unsaved(heldAtom))` from `@deslop/runtime/mobile/unsaved`; otherwise a downloaded update reloads over it.
- An item in `ListDetail`'s detail with nothing to scroll, such as a draft, carries `barNeverMinimizes` from `lib/toolbar`: iOS 27 keeps the bar minimized by the scrolled item it replaced, without its title and buttons.
