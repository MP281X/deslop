# Portfolio

Public profile and printable CV, with live visitor cursors, trails and two wandering server bots. No sign-in or persistence on the server. Each browser tab keeps its guest identity through reloads; tabs sharing an identity share one cursor until the last tab closes.

The room holds plain state. Its single bot stream runs only while visitors occupy the room; a join span covers each visitor's connection.

Presence defects, such as a tab open across a release receiving a scene it cannot decode, are terminal, unlike retried transport drops: the realtime boundary shows an unavailable HUD without replacing the public profile or CV. The server's scene owns each identity's colour.

## Journeys

- Open the profile and `/cv`; profile links and the printable CV remain available without presence.
- Move the own cursor, open a second visitor and see both cursors move live; the bots wander while the room is occupied and stop when the last tab leaves.
- Reload and reconnect with the same guest identity, keeping the live room functional.
- Use 1–6 to jump sections, R to recolour and ? to open the shortcut legend. The focused reading region supports normal paging keys.
