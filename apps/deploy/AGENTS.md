# Deploy intent

- **Excluded.** A machine filter, a Monitor page (`/monitor` redirects), Memory|CPU tabs, the metric in the URL, per-core, network or disk I/O charts, per-app % or MB figures, an end action on apps, a chart band for jobs.
- **Machines.** An unreachable one shows a hollow dot beside its name, no status text or popover; one machine hides the control.
- **Expose.** Ask only who reaches it: Tailnet or Public, on every worker; a Mac refuses Public before recording anything.
- **Mac.** The third worker, under launchd: its apps are its `deslop-*` launch agents, without the `-update` ones, and it has no jobs. With no cgroups, its history carries no per-app bands, so the range never hides its rows.
- **Processes.** PID and PPID stay internal; never read environment; omit nameless listeners and ordinary system-service noise.
- **Recovery.** A sleeping worker never delays another worker's refresh, local monitoring or the shell. An authorised empty history is empty, not loading.
