# Scope intent

- **Operations.** One list for the chosen app, without groups or headings: failures lead, then most recently seen. An operation is a root span's name.
- **Traces.** A row's hover names the failing span; selecting opens its diagnostic, never a repeated row message. New arrivals appear without rescanning every trace.
- **Selection.** The URL stores operation, trace and span ids, never record copies.
- **CI.** GitHub Actions is the CI side: workflows are operations, runs are traces of jobs and steps. A failed job keeps its whole log; a successful one keeps runner warnings and errors and the last 10 lines of each step the workflow itself runs.
- **Phone.** Keep every operation column and push trace detail full-screen; focus follows Tab, never selection.

## Boundary facts

- **App tabs.** App names, CI identity and failure-first order cover all retained settled traces. The selected time frame bounds operations only; a quiet app keeps its selectable tab with no operation rows.

- **OTLP time.** Epoch nanoseconds decode to an exact Duration; durations come from them exactly, UTC starts truncated to microseconds. Sender metadata is normalized once per resource group, not per record.
- **OTLP absence.** Each wire form of an absent value means one absence: a missing or empty parent span or log correlation id decodes to None, and log identities hash either form as the same empty string.
- **OTLP bodies.** HTTP bodies are JSON; vendor extensions pass through unchanged, and instrumentation scope and schema URLs are not read.
