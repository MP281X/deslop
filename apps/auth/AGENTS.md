# Auth intent

- **Sign-ins.** One Card, most recently active first. A browser's child app sign-ins add to its latest activity, never separate rows; signing it out ends them all. Never narrow the client list.
- **Excluded.** Apps that open on their sign-ins, devices first, a launcher, an activity feed, a page built around a big code field.
- **Transient records.** GitHub flows, authorization codes, sign-in requests (including device codes) and passkey challenges share expiring in-memory records; a restart cancels them, never a session already issued.
- **Registration identity.** A removed person can rejoin with the same GitHub id while an old approval or failed credential cleanup still exists; credentials and approvals retain their original registration, never the new one's access.
- **Callbacks.** Outside local development, web callbacks belong only to first-party `*.mp281x.xyz` apps; a tailnet preview is not an allowed app callback.

## Journeys

- **Web sign-in.** Use GitHub, a passkey or an approved code, then return to the requesting app without a second approval.
- **Client approval.** Approve an iOS or agent code; its token works across Deslop apps and refreshes without another approval.
