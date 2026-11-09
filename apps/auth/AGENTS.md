# Auth intent

- Signed in is one Card of 32px rows (44 on phones), most recently active first: each client's mark in one 16px slot, the device as the row's name, last activity and address when it differs from the device, hidden on phones; the app or browser is named by the mark alone. Its trash button signs it out from every app at once, without confirmation; a failed sign-out stays under its row.
- A waiting sign-in leads that Card, tinted: its app mark, device and the muted code on one line, then Deny and Approve. The code field, with no visible label and a key icon, stays above the Card.
- Staleness shows once per page, in the bar's Problem: the oldest stale reader of the view and one retry that refreshes them all. Rows stay unmarked.
- Rejected: apps that open on their sign-ins, devices first, a launcher, an activity feed, a page built around a big code field.
- The bar switches between Sign-ins and People; signing out of every app stays in the account menu. Rows carry their own actions at their end, never a context menu: one action is an icon button, several sit behind one … menu. A client's trash signs it out, a member's removes them. The client list itself is never narrowed.
- A browser's child app sign-ins contribute to its row's latest activity, never rows of their own; signing the browser out ends them all.
- Loading is skeleton rows at the loaded geometry, never a spinner; a sign-in button that waits keeps its own icon and disabled label. Only the bar shows until the account is known, then the page that will render gets its own skeleton: the signed-in list at the top, the sign-in page centred.
- People are one Card of 32px rows (44 on phones): a 16px square picture, name with the GitHub handle muted inline; whoever asks for access leads with Decline and Allow. Every admin or member row ends with the same since-date column and one 24px slot (44 on phones), the admin's shield in the app's hue or a removable member's trash centred in it; your own row and an admin's show no trash, a member's removal waits eight seconds with Undo, and a failed removal keeps the row and its reason.

## Journeys

- Sign into Auth with GitHub, a passkey or an approved code, then return to the requesting web app without a second approval.
- Approve an iOS or agent sign-in by its code; its access token works across Deslop apps and refreshes without another approval.
- Inspect a client's row and sign it out; signing a browser out ends its child app sign-ins together.
