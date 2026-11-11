# Auth intent

- **Sign-ins.** One Card, most recently active first. A browser's child app sign-ins add to its latest activity, never separate rows; signing it out ends them all. Never narrow the client list.
- **Excluded.** Apps that open on their sign-ins, devices first, a launcher, an activity feed, a page built around a big code field.

## Journeys

- **Web sign-in.** Use GitHub, a passkey or an approved code, then return to the requesting app without a second approval.
- **Client approval.** Approve an iOS or agent code; its token works across Deslop apps and refreshes without another approval.
