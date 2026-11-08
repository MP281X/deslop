import {judgedRule} from '#judge/rule.ts'

export const noRestatingComment = judgedRule({
	criteria: {
		false:
			'Domain meaning, units, external formats, sibling relationships, why a field is missing, invariants, migration fixtures and library limitations add information even if the comment also describes an operation. Comments outside `code` are not present.',
		true: 'A comment inside the unit only narrates an obvious adjacent operation or describes a past refactor, with no reason, constraint or non-obvious invariant.'
	},
	examples: {
		bad: `// Loop over the notes and add each id to the set
function ids(notes: Note[]) {
	// create a new set
	const seen = new Set<string>()
	// changed from an array to a set in the refactor
	for (const note of notes) seen.add(note.id)
	return seen
}`,
		good: `// Ids repeat across devices until a sync settles, so duplicates collapse here rather than in storage.
function ids(notes: Note[]) {
	const seen = new Set<string>()
	for (const note of notes) seen.add(note.id)
	return seen
}`
	},
	kind: 'code',
	message:
		'Delete the comment, or replace it with the outside constraint the code cannot say; a name says what, history lives in git.',
	question:
		'Does a comment inside `code` merely narrate an obvious operation or past edit without explaining a constraint or reason?'
})
