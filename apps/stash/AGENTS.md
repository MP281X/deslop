# Stash intent

- **Queue.** One list: the share extension, clipboard and compose screen all save into it.
- **Article.** Stash reads and tags each saved link once.
- **Changes.** Note transitions are pure functions; the Notes service alone stores their results. Production notes stay untouched until loaded into SQL by hand.

## Journeys

- **Share.** Sign in, then share a link from Safari: the extension saves it with the app's session and it joins the list.
- **Retry.** Open an unreadable note: it says why, keeps what was read and offers retry.
- **Delete.** Remove a note by swipe, menu or from its detail; Undo stays in the row.
