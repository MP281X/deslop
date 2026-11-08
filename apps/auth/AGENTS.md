# Auth intent

- Signed in lists one row per client and device, most recently active first: its mark, label, last activity and address when it differs from the device, hidden on phones. Its context menu signs it out from every app at once, without confirmation; a failed sign-out stays under its row.
- A waiting sign-in's Approve and Deny card leads the section. The code field, with no visible label, stays above the list in the same centred column; rows have edge-to-edge dividers.
- Apps open from the palette. Rejected: apps that open on their sign-ins, devices first, a launcher, an activity feed, a page built around a big code field.
- The bar's palette lists every app that announced itself, Sign-ins, People for an admin, and signing out of every app; typing filters them. Searching is how the page moves; the client list itself is never narrowed.
- A browser's child app sign-ins contribute to its row's latest activity, never rows of their own; signing the browser out ends them all.
- People are one line each: picture, name, GitHub handle; whoever asks for access leads with Allow and Decline on the row, an admin is marked, a member shows since when and is removed from the row's context menu.

## Journeys

- Sign into Auth with GitHub, a passkey or an approved code, then return to the requesting web app without a second approval.
- Approve an iOS or agent sign-in by its code; its access token works across Deslop apps and refreshes without another approval.
- Inspect a client's row and sign it out; signing a browser out ends its child app sign-ins together.
