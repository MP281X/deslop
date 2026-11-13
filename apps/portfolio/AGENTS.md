# Portfolio

Public profile and printable CV, with live visitor cursors, trails and two wandering server bots. No sign-in or persistence on the server. Each browser tab keeps its guest identity through reloads; tabs sharing an identity share one cursor until the last tab closes.

The room holds plain state. Its single bot stream runs only while visitors occupy the room. Cursor moves and wander ticks are not traced; a join span covers the visitor's connection.

## Journeys

- Open the profile and `/cv`; profile links and the printable CV remain available without presence.
- Move the own cursor, open a second visitor and see both cursors move live; the bots wander while the room is occupied and stop when the last tab leaves.
- Reload and reconnect with the same guest identity, keeping the live room functional.
- Use 1–6 to jump sections, R to recolour and ? to open the shortcut legend. The focused reading region supports normal paging keys.
