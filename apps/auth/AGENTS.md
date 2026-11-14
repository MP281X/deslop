# Auth intent

- **Sign-ins.** One table, most recently active first. A browser's child app sign-ins add to its latest activity, never separate rows; signing it out ends them all. Never narrow the client list.
- **Session tools.** Every live root family is listed and revocable by id; only the web page groups them.
- **Excluded.** Apps that open on their sign-ins, devices first, a launcher, an activity feed, a page built around a big code field.
- **Transient records.** GitHub flows, authorization codes, sign-in requests (including device codes) and passkey challenges share expiring in-memory records; a restart cancels them, never a session already issued.
- **Registration identity.** Access belongs to a registration, not a GitHub id: a removed person who rejoins starts a new registration that inherits no earlier credential or approval.
- **Callbacks.** Outside local development, web callbacks belong only to first-party `*.mp281x.xyz` apps.

## Journeys

- **Web sign-in.** Use GitHub, a passkey or an approved code, then return to the requesting app without a second approval.
- **Client approval.** Approve an iOS or agent code; its token works across Deslop apps and refreshes without another approval.
