# Auth intent

- **Sessions.** One browser session per row, most recently active first. Tailnet callers need no session.
- **People.** GitHub browser sign-ins wait for an admin unless already allowed or admin.
- **Transient records.** GitHub PKCE flows expire in memory; restarting cancels them, never a browser session already issued.
- **Excluded.** Device codes, app grants, OAuth servers, client registrations and launchers.
