# Deploy intent

- **Excluded.** A Monitor page, Memory|CPU tabs, the metric in the URL, per-core, network or disk I/O charts, per-app % or MB figures, an end action on apps, a chart band for jobs.
- **One machine.** Show only the Linux machine Deploy runs on: no machine switcher, no link to another machine's Deploy, no macOS inventory.
- **Expose.** Ask only who can reach the port: Tailnet or Public.
- **Processes.** Hide process IDs, nameless listeners and routine system services. Leave process environments unread.
- **History.** Show an authorised empty history as empty, not loading.
- **Updates.** `POST /api/update` is the one anonymous surface: it only starts the apps' update units, which install what is already on npm.
