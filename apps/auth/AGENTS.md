# Auth intent

- Signed in is one Card of 32px rows (44 on phones), most recently active first: each client's mark in one 16px slot, the device as the row's name, last activity and address when it differs from the device, hidden on phones; the app or browser is named by the mark alone.
- A waiting sign-in leads that Card, tinted: its app mark, device and the muted code on one line, then Deny and Approve. The code field, with no visible label and a key icon, stays above the Card.
- Rejected: apps that open on their sign-ins, devices first, a launcher, an activity feed, a page built around a big code field.
- The bar switches between Sign-ins and People; signing out of every app stays in the account menu. Agents sign a client out from every app at once, remove a member or remove a passkey through the `sign_out_session`, `remove_person` and `remove_passkey` MCP tools. The client list itself is never narrowed.
- A browser's child app sign-ins contribute to its row's latest activity, never rows of their own; signing the browser out ends them all.
- Only the bar shows until the account is known, then the page that will render gets its own skeleton: the signed-in list at the top, the sign-in page's app list.
- People are one Card of 32px rows (44 on phones): a 16px square picture, name with the GitHub handle muted inline and an admin's shield after the handle; whoever asks for access leads with Decline and Allow. Every admin or member row ends with the same since-date column, wide enough for "Nov 2026" on one line.

## Journeys

- Sign into Auth with GitHub, a passkey or an approved code, then return to the requesting web app without a second approval.
- Approve an iOS or agent sign-in by its code; its access token works across Deslop apps and refreshes without another approval.
- Sign a client out through `sign_out_session`; signing a browser out ends its child app sign-ins together.
