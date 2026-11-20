# Auth intent

- **Sessions.** Show one browser session per row, most recently active first. Tailnet callers need no session.
- **People.** GitHub sign-ins wait for an admin unless the person is already allowed or is an admin. A tailnet sighting lets a person in from the tailnet but approves no browser; declining them keeps that. A tailnet user stays the GitHub account its first sighting resolved, never asked by login again, until the person is removed. An unfinished sign-in can expire without affecting existing sessions.
- **Excluded.** Device codes, app grants, OAuth servers, client registrations and launchers.
