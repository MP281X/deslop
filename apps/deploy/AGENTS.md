# Deploy intent

- One fleet, with an All machines filter that includes every worker. Machine identity uses a stable colored device icon, not repeated hostnames; names remain in filters and accessible labels.
- Apps and monitoring have separate pages. Apps puts exposure first, with app-centric rows: type icon, name, endpoint pills and status dot. No raw peer list, protocol labels, image tags or detached details panel.
- Exposure controls keep their height when switching Tailnet/Public; Tailnet has no hostname input, and Public's hostname shares the input row. The picker spans the phone width and wraps names. Already exposed backends are absent. Use the shared Auth control and badge vocabulary.
- A sleeping worker must not delay local monitoring or the page shell. Show cached history immediately, then refresh workers with bounded deadlines and explicit offline states.
- Monitor is a dense btop-like view: aggregate and individual CPU cores, memory breakdown and swap, mounted storage, network and disk I/O. Show real recording coverage instead of squeezing a new installation into an otherwise empty time window.
- Consistent control heights, row columns and chart baselines on phone and desktop. Meaningful information is visible without expanding records.
