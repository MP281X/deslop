# Deploy intent

- **Excluded.** A machine filter, a Monitor page, Memory|CPU tabs, the metric in the URL, per-core, network or disk I/O charts, per-app % or MB figures, an end action on apps, a chart band for jobs.
- **Machines.** Mark an unreachable machine with a hollow dot beside its name. Show no status text or popover. Hide the machine control when there is only one.
- **Expose.** On every worker, ask only who can reach the port: Tailnet or Public. A Mac refuses Public.
- **Mac.** Show running Dock apps, including Finder. Show user agents and nested helpers under their app, even if it only lives in the tray. Use the app's display name, bundle name or file name, in that order. Keep the label for an agent whose app is unknown. Keep Deslop app names and hide updater agents. Show no Mac jobs or per-app history bands. Changing the range never hides Mac app rows.
- **Processes.** Hide process IDs, nameless listeners and routine system services. Never read process environments.
- **Recovery.** A sleeping worker never delays another worker's refresh, local monitoring or the shell. Show an authorised empty history as empty, not loading.
