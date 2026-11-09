# Auth intent

- Signed in is one Card of 48px rows, most recently active first: each client's mark in one 16px slot, label, last activity and address when it differs from the device, hidden on phones. Its context menu signs it out from every app at once, without confirmation; a failed sign-out stays under its row.
- A waiting sign-in leads that Card, tinted: its app mark, label over the muted code, then Deny and Approve. The code field, with no visible label and a key icon, stays above the Card.
- Staleness shows once per page, in the bar's Problem: the oldest stale reader of the view and one retry that refreshes them all. Rows stay unmarked.
- Rejected: apps that open on their sign-ins, devices first, a launcher, an activity feed, a page built around a big code field.
- The bar switches between Sign-ins and People; signing out of every app stays in the account menu. Rows carry their own actions: a client's context menu signs it out, a member's removes them. The client list itself is never narrowed.
- A browser's child app sign-ins contribute to its row's latest activity, never rows of their own; signing the browser out ends them all.
- People are one Card of 48px rows: square picture, name over the GitHub handle; whoever asks for access leads with Decline and Allow, an admin carries a shield in the app's hue, a member shows since when and is removed from the row's context menu after eight seconds with Undo; a failed removal keeps the row and its reason.

## Journeys

- Sign into Auth with GitHub, a passkey or an approved code, then return to the requesting web app without a second approval.
- Approve an iOS or agent sign-in by its code; its access token works across Deslop apps and refreshes without another approval.
- Inspect a client's row and sign it out; signing a browser out ends its child app sign-ins together.
