# Portfolio

Public profile and printable CV, with live visitor cursors, trails and two wandering server bots. No sign-in or persistence on the server. Each browser tab keeps its guest identity through reloads; tabs sharing an identity share one cursor until the last tab closes.

The room holds plain state. Its single bot stream runs only while visitors occupy the room; a join span covers each visitor's connection.

Presence defects, such as a tab open across a release receiving a scene it cannot decode, are terminal, unlike retried transport drops: the realtime boundary shows an unavailable HUD without replacing the public profile or CV. The server's scene owns each identity's colour.
