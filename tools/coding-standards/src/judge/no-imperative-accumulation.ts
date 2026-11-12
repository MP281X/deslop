import {question} from '#lib/question.ts'

export const noImperativeAccumulation = question(
	'code',
	'Does `code` use a mutable accumulator only to build a pure collection or total that one map, filter, flatMap, reduce, groupBy or partition gives directly?',
	{
		// An accumulator is written to once per item, from a loop or a per-item callback.
		gate: unit => unit.iterates && unit.mutates,
		message: 'Build the result with one declarative operation instead of a mutable accumulator.',
		no: {
			cases: [
				'Effects run in order that collect their results while installing or updating something',
				'Output that depends on earlier items, such as interpolation or a tokenizer, which one operation cannot express',
				'A mutable builder an API requires, such as a stream emitter',
				'Mutation the surrounding comment justifies, such as measured performance'
			],
			example: `
				function tagsOf(notes: Note[]) {
					return Array.flatMap(notes, note => note.tags)
				}
			`
		},
		yes: {
			cases: [
				'A for or forEach loop that pushes into an array, or sets keys on an object, created before the loop, with each item handled independently',
				'A loop that adds into a running total or count kept in a mutable holder'
			],
			example: `
				function tagsOf(notes: Note[]) {
					const tags: string[] = []
					for (const note of notes) {
						for (const tag of note.tags) tags.push(tag)
					}
					return tags
				}
			`
		}
	}
)
