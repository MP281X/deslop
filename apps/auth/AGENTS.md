# Auth intent

- Signed in is one Card of 32px rows (44 on phones), most recently active first: each client's mark in one 16px slot, the device as the row's name, last activity and address when it differs from the device, hidden on phones; the app or browser is named by the mark alone. Agents sign a client out from every app at once with the `sign_out_session` MCP tool; the page has no removal control.
- A waiting sign-in leads that Card, tinted: its app mark, device and the muted code on one line, then Deny and Approve. The code field, with no visible label and a key icon, stays above the Card.
- Staleness shows once per page, in the bar's Problem: the oldest stale reader of the view and one retry that refreshes them all. Rows stay unmarked.
- Rejected: apps that open on their sign-ins, devices first, a launcher, an activity feed, a page built around a big code field.
- The bar switches between Sign-ins and People; signing out of every app stays in the account menu. Rows carry their own actions at their end, never a context menu: one action is an icon button, several sit behind one … menu. Agents sign a client out or remove a member through the `sign_out_session` and `remove_person` MCP tools. The client list itself is never narrowed.
- A browser's child app sign-ins contribute to its row's latest activity, never rows of their own; signing the browser out ends them all.
- Loading is skeleton rows at the loaded geometry; a sign-in button that waits keeps its own icon and disabled label. Only the bar shows until the account is known, then the page that will render gets its own skeleton: the signed-in list at the top, the sign-in page's app list.
- People are one Card of 32px rows (44 on phones): a 16px square picture, name with the GitHub handle muted inline and an admin's shield right after the name; whoever asks for access leads with Decline and Allow. Every admin or member row ends with the same since-date column, wide enough for "Nov 2026" on one line; agents remove a member through the `remove_person` MCP tool, never in the page.

## Journeys

- Sign into Auth with GitHub, a passkey or an approved code, then return to the requesting web app without a second approval.
- Approve an iOS or agent sign-in by its code; its access token works across Deslop apps and refreshes without another approval.
- Sign a client out through `sign_out_session`; signing a browser out ends its child app sign-ins together.
