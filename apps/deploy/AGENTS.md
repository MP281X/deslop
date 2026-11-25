# Deploy intent

- **Excluded.** A machine filter, a Monitor page, Memory|CPU tabs, the metric in the URL, per-core, network or disk I/O charts, per-app % or MB figures, an end action on apps, a chart band for jobs.
- **Machines.** Mark an unreachable machine with a hollow dot beside its name, with no status text or popover. Hide the machine control when there is only one.
- **Expose.** On every worker, ask only who can reach the port: Tailnet or Public. A Mac refuses Public.
- **Mac.** Show running Dock apps, including Finder. Show user agents and nested helpers under their app, even if it only lives in the tray. Name an app by its display name, else its bundle name, else its file name. Keep the label for an agent whose app is unknown. Keep Deslop app names and hide updater agents. Show no Mac jobs or per-app history bands. Keep Mac app rows visible whatever the range.
- **Processes.** Hide process IDs, nameless listeners and routine system services. Leave process environments unread.
- **Recovery.** Refresh other workers, monitor locally and serve the shell without waiting on a sleeping worker. Show an authorised empty history as empty, not loading.
