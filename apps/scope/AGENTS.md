# Scope intent

- **Operations.** Show one list for the chosen app, without groups or headings. Use the root span name. Show failures first, then the most recently seen operations. Keep quiet apps selectable even when their list is empty in the chosen time frame.
- **Traces.** Hover a row to see the failing span. Select it to open the diagnostic, which does not repeat the row message. Show new arrivals as they come in. Link directly to an operation, trace or span.
- **CI.** Show GitHub Actions workflows as operations and runs as traces of jobs and steps. Keep the full log of a failed job. For a successful job, keep runner warnings and errors and the last 10 lines of each step the workflow runs itself.
- **Phone.** Keep every operation column. Open trace details full-screen. Move focus with Tab only, never by selecting.
