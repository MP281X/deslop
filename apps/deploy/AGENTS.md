# Deploy intent

- One fleet with every worker in the machine filter. Neutral device icons and short names identify machines; offline state belongs in that selector, not a warning paragraph.
- Apps and monitoring have separate pages. Apps puts exposure first, with app-centric rows: type icon, name, endpoint pills and status dot. No raw peer list, protocol labels, image tags or detached details panel.
- Exposure controls keep their height when switching Tailnet/Public; Tailnet has no hostname input, and Public's hostname shares the input row. The picker spans the phone width and wraps names. Already exposed backends are absent. Use the shared Auth control and badge vocabulary.
- A sleeping worker must not delay local monitoring or the page shell. Show cached history immediately, then refresh workers with bounded deadlines and explicit offline states.
- Monitor defaults to four compact trends: CPU, memory, storage and network. One current reading per metric, no repeated percentages/bars/axes. Per-core and secondary memory/I/O records live in Details.
- Context controls stay above the scrolling results. Processes nest under their real service/container, with application icons when known, PID, parent and RSS; no command lines or environment contents.
- Consistent control heights, row columns and chart baselines on phone and desktop. Meaningful information is visible without expanding records.
