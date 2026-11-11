# Auth intent

- **Sign-ins.** One Card, most recently active first: each client's mark names the app or browser, the device names the row, followed by last activity and an address when it differs from the device; activity and address hide on phones. A browser's child app sign-ins contribute to its latest activity, never separate rows; signing it out ends them all.
- **Approval.** A waiting sign-in leads the Card, tinted: its app mark, device and muted code, then Deny and Approve. The code field, with no visible label and a key icon, stays above the Card.
- **Excluded.** Apps that open on their sign-ins, devices first, a launcher, an activity feed, a page built around a big code field.
- **Bar.** Switch between Sign-ins and People; signing out of every app stays in the account menu. Agents use `sign_out_session`, `remove_person` and `remove_passkey` to sign a client out everywhere, remove a member or remove a passkey. Never narrow the client list.
- **Loading.** Only the bar shows until the account is known, then skeletons match the destination: the signed-in list at the top, or the sign-in page's app list.
- **People.** One Card: picture, name, GitHub handle muted inline and an admin's shield after it; access requests lead with Decline and Allow. Admins and members end with the same since-date column, wide enough for "Nov 2026".

## Journeys

- **Web sign-in.** Use GitHub, a passkey or an approved code, then return to the requesting app without a second approval.
- **Client approval.** Approve an iOS or agent code; its token works across Deslop apps and refreshes without another approval.
