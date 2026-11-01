# Deploy intent

- One fleet, with an All machines filter that includes every worker. Machine identity uses a stable colored device icon, not repeated hostnames; names remain in filters and accessible labels.
- Apps and monitoring have separate pages. Apps puts exposure first, with app-centric rows: type icon, name, endpoint pills and status dot. No raw peer list, protocol labels, image tags or detached details panel.
- Exposure controls keep their height when switching Tailnet/Public; already exposed backends are absent from the picker. Use the shared Auth control and badge vocabulary.
- Monitor is a dense btop-like view: aggregate and individual CPU cores, memory breakdown and swap, mounted storage, network and disk I/O. Show real recording coverage instead of squeezing a new installation into an otherwise empty time window.
- Consistent control heights, row columns and chart baselines on phone and desktop. Meaningful information is visible without expanding records.
