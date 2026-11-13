# Scope intent

- **Operations.** One list for the chosen app, without groups or headings: failures lead, then most recently seen. An operation is a root span's name.
- **Traces.** A row's hover names the failing span; selecting opens its diagnostic, never a repeated row message. New arrivals appear without rescanning every trace.
- **Selection.** The URL stores operation, trace and span ids, never record copies.
- **CI.** GitHub Actions is the CI side: workflows are operations, runs are traces of jobs and steps.
- **Phone.** Keep every operation column and push trace detail full-screen; focus follows Tab, never selection.

## Boundary facts

- **App tabs.** App names, CI identity and failure-first order cover all retained settled traces. The selected time frame bounds operations only; a quiet app keeps its selectable tab with no operation rows.

- **OTLP time.** Decimal epoch nanoseconds decode to an exact Duration, not an extended DateTime object. Ingestion derives UTC starts with the existing microsecond truncation and derives durations from exact nanoseconds. Sender metadata is normalized once per resource group, not per record. Stored start/time keep their existing fractional-millisecond encoding.
- **OTLP correlation.** A missing or empty parent span id or log correlation id decodes to one None; the optional-key codec omits None. Log identities normalize either wire form to the same empty string before hashing.
- **Error causes.** A cause is optional diagnostic metadata, not domain absence; nobody branches on it, so it stays Schema.optional(Defect).
- **OTLP extensions.** HTTP bodies are JSON. Vendor object extensions are preserved by the struct parser, not intersected with a JSON index signature that would reject decoded Option and Duration fields. Instrumentation scope and schema URLs are not read.
