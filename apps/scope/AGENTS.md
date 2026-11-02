# Scope intent

- One live page, no panes: each app that sent traces is a section with its mark, apps with failures first. Its rows are operations (a root span's name): runs, typical and slowest-5% durations, and the failure count as a red badge with no word; failures first, then the busiest. The page updates as traces arrive, without a refresh button.
- An operation opens on its slowest traces, slowest first, its newest failures always among them, one line each: age, then at the right a red badge naming the span where it broke, like the operation's failure count, and the duration; no bar and no error text. The error shows first in the span that broke, once opened. Only top-level traces are rows; their spans never are.
- A trace opens under its row on its spans, each on the trace's own time scale with no axis labels; the first failure starts picked. Only a span with something more to show opens; a picked one shows its attributes and logs, not its name or duration again, an attribute that only repeats its name (such as code.function), or the app the section already names.
- On a phone an operation keeps its name, failures and slowest duration; runs and typical duration show from wider screens.
- Chevrons sit at the right and the whole row opens, as in Deploy. The bar's field narrows apps and operations; no filter chips or commands.
