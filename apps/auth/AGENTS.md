# Auth intent

- **Authority.** Auth names every caller, including its own pages and tools, through a shared browser session or tailnet identity.
- **Sessions.** One browser session per row, most recently active first; signing one out ends it across all apps. Tailnet callers need no session.
- **People.** GitHub browser sign-ins wait for an admin unless already allowed or admin. Tailnet invitations approve people automatically; removing them deletes sessions, and their next tailnet request registers them again.
- **Transient records.** GitHub PKCE flows expire in memory; restarting cancels them, never a browser session already issued.
- **Excluded.** Device codes, app grants, OAuth servers, client registrations and launchers.
