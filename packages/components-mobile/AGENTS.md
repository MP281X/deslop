# Components mobile

- Name a list screen inline in the navigation bar (`ListToolbar`), never with a large title: the user's exception to the root's "No page titles".
- A screen holding typed, unsaved text tells the updater with `useAtomMount(unsaved(heldAtom))` from `@deslop/runtime/mobile/unsaved`; otherwise a downloaded update reloads over it.
- An item in `ListDetail`'s detail with nothing to scroll, such as a draft, carries `barNeverMinimizes` from `lib/toolbar`, or iOS 27 keeps the bar the previous item minimized, without its title and buttons.
