# Architecture evaluations

## architecture

### Task

Let me import a folder of data files, see progress and stop without losing completed records. Choose the architecture before writing product code. Explain only the decisions I need to make.

### Criteria

Judge the mechanism and caller obligations, not the number of modules or diagrams.

- Trace existing CLI, HTTP and browser consumers and preserve single-file behavior.
- Keep persistence and cancellation in the existing service and its operation scope.
- Reject an unnecessary job registry, detached writer, mirrored progress store and generic importer factory.
- Give completion one observable meaning: the emitted record is durable.
- Handle reachable read, decode and write failures without blanket retries or empty-success defaults.
- Use a disposable experiment for an uncertain technical contract; decide an unresolved user outcome from exploration and show it beside the strongest alternative; ask no question.
- Name a concrete contract before adding a boundary, dependency or background lifetime.

Grade simplicity and preserved behavior separately. A written design does not prove its implementation. Keep integrated planning and steering evaluations separate from this selected-skill case.
