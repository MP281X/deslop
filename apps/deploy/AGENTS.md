# Deploy intent

- **Excluded.** A machine filter, a Monitor page, Memory|CPU tabs, the metric in the URL, per-core, network or disk I/O charts, per-app % or MB figures, an end action on apps, a chart band for jobs.
- **Machines.** An unreachable one shows a hollow dot beside its name, no status text or popover; one machine hides the control.
- **Expose.** Ask only who reaches it: Tailnet or Public, on every worker; a Mac refuses Public before recording anything.
- **Mac.** Running Dock apps stay, including Finder. User agents inside an app bundle take its display name (then bundle name, then file name) and share one row and process tree with that app, including tray-only apps; nested helpers belong to the enclosing app. Programs under `/System`, `/usr`, `/bin`, `/sbin` or `/Library/Apple` and `com.apple.*` agents are noise; unresolved agents keep their label. Deslop agents keep their app names and omit `-update`. Bundle metadata needs no additional permissions. A Mac has no jobs or per-app history bands, so the range never hides its rows.
- **Processes.** PID and PPID stay internal; never read environment; omit nameless listeners and ordinary system-service noise.
- **Recovery.** A sleeping worker never delays another worker's refresh, local monitoring or the shell. An authorised empty history is empty, not loading.

## Boundary facts

- **Peer commands.** DEPLOY_WORKERS lists Tailscale machine names. A peer-only command has no worker target and always commits locally, then refreshes the shared inventory before returning; it never forwards again. Every command's completion invalidates page snapshots.
- **Collector input.** Machine output is untrusted: an empty field and a missing key are the same absence, a malformed row is skipped or loses its unreadable metadata, and a failure to parse whole-machine figures is a `DeployError`, never a defect.
