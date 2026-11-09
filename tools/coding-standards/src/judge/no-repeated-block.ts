import {question} from '#lib/question.ts'

export const noRepeatedBlock = question(
	'code',
	'Does `code` repeat the same sequence of two or more operations, differing only in an input value, where one local helper or loop would write it once without hiding a difference in meaning?',
	{
		message: 'Write the repeated steps once and apply them to each value.',
		no: {
			cases: [
				'Sibling JSX elements, object fields or per-variant results that describe different facts, even when their expressions look alike',
				'Adapters, subscriptions or union branches whose parsing, contracts, identity or retention rules differ',
				'Assertions repeated at different stages of one scenario',
				'One call repeated with different arguments, one line each',
				'Source code inside fixture strings'
			],
			example: `
				function badges(note: Note) {
					function normalized(values: string[]) {
						return Array.sort(Array.dedupe(Array.map(values, String.toLowerCase)), String.Order)
					}
					return {authors: normalized(note.authors), tags: normalized(note.tags)}
				}
			`
		},
		yes: {
			cases: [
				'The same parse-and-decode or normalize-and-sort sequence written out separately for several inputs',
				'Identical multi-step handlers or branches that differ only in the value they act on'
			],
			example: `
				function badges(note: Note) {
					const tags = Array.dedupe(Array.map(note.tags, String.toLowerCase))
					const sortedTags = Array.sort(tags, String.Order)
					const authors = Array.dedupe(Array.map(note.authors, String.toLowerCase))
					const sortedAuthors = Array.sort(authors, String.Order)
					return {authors: sortedAuthors, tags: sortedTags}
				}
			`
		}
	}
)
