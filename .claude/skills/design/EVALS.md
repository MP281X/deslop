# design evaluations

## design

### Task

Make importing records clear and comfortable on my iPhone, including progress, stopping and seeing what was kept. Show me the design before changing the service.

### Criteria

Judge the browser experience, not the amount of UI produced.

- Use the existing import workspace and realistic record names.
- Make idle, active, cancelled, completed and empty states understandable.
- Keep completed records visible when the import stops; distinguish stop from undo.
- Establish readable light and dark views at 390-point width, touch targets and keyboard access.
- Settle the representative journey with the user before backend changes; expand only its approved direction.
- Remove redundant controls and status text; use interaction to explore a real consequence, not to navigate an explanation.

Inspect every visible state and transition. Grade hierarchy, behavior and readability independently of engineering and proof-capture quality. The user judges the final variants.

## overview-format

### Task

Give me a quick overview of these changes: Review moved into coding-standards; Architecture was added; open choices get an inline prototype beside the production code, with no approval wait; routine fixes need no prototype; proof uses inline probes before permanent tests. These instruction changes are local, not installed. There are no UI captures, measurements or interactive choices to show.

### Criteria

- Use a short Markdown table or list. Do not produce HTML, an image of the same rows, controls or a separate presentation app.
- Keep every supplied distinction, including routine fixes and installation state, with the fewest words that remain clear.
- Do not add an introduction or duplicate the overview in a summary.
- Judge the delivered artifact, not an explanation of format selection. Leave native-run behavior unproved until the case runs.

## animated-mechanism

### Task

Show why an importer must write a record before reporting progress. Show the record becoming durable, then the progress event, as a short automatic animation. Do not make me click. This is an illustrative explanation, not evidence from a real application.

### Criteria

- Use the animation to show the named record, durable storage and progress event in the correct causal order.
- Keep the message understandable without controls, extra introductions or duplicated prose.
- Distinguish illustration from application proof; inspect actual timing rather than inferring motion from a still.
- HTML adds the requested animated mechanism; a styled list of phases alone does not meet the task.
