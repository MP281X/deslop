# Auth intent

- Sign-ins is a grid: apps down, signed-in clients across, a dot in Auth's hue where one holds the other and a hollow one where it doesn't. One column per client and device, most recently active first; its mark is the header, hovering names it with when it was last active and the address it last called from, and a click opens Sign out from every app at once.
- A sign-in waiting for an answer leads as an outlined column whose dots breathe on the apps it asks for, under its Approve and Deny; the code field stays above the grid.
- Agents is where an agent on another machine gets a bearer token for the Gateway's MCP endpoint: a name and an expiry, then the token and the Claude Code command, shown once. Below, one line per token with when it was created, last used and expires, revoked from its context menu; a token never appears in the sign-ins grid.
- An app's name opens it. Rejected: apps that open on their sign-ins, devices first, a launcher, an activity feed, a page built around a big code field.
- The bar's palette lists every app that announced itself, Sign-ins, Agents, People for an admin, and signing out of every app; typing filters them. Searching is how the page moves; the grid itself is never narrowed.
- People are one line each: picture, name, GitHub handle; whoever asks for access leads with Allow and Decline on the row, an admin is marked, a member shows since when and is removed from the row's context menu.
