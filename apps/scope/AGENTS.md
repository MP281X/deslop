# Scope intent

- **Operations.** One list for the chosen app, without groups or headings: failures lead, then most recently seen. An operation is a root span's name.
- **Traces.** A row's hover names the failing span; selecting opens its diagnostic, never a repeated row message. New arrivals appear without rescanning every trace.
- **Selection.** The URL stores operation, trace and span ids, never record copies.
- **CI.** GitHub Actions is the CI side: workflows are operations, runs are traces of jobs and steps.
- **Phone.** Keep every operation column and push trace detail full-screen; focus follows Tab, never selection.

## Boundary facts

- **OTLP time.** Decimal nanoseconds can differ below a UTC instant's floating-point precision. The decoded UTC value retains its original spelling and exact Duration offset until ingestion computes the span duration; stored start/time keep their existing fractional-millisecond encoding.
- **OTLP extensions.** HTTP bodies are JSON. Vendor object extensions are preserved by the struct parser, not intersected with a JSON index signature that would reject decoded Option and DateTime fields. Instrumentation scope and schema URLs are not read.
