import {Array, Order, String, pipe} from 'effect'

export type Kind = 'code' | 'component' | 'test'

export type Side = {cases: Array.NonEmptyReadonlyArray<string>; example: string}

// One narrow yes-or-no question about `code`, asked of every unit of its kind: `yes` is the violation, `message` tells the agent the fix, and the judge checks it answers its own examples.
export type Question = {kind: Kind; message: string; no: Side; question: string; yes: Side}

// An example is written indented inside its question; Jev reads it without the opening and closing lines and their shared indent.
function dedent(example: string) {
	const lines = Array.dropRight(Array.drop(String.split('\n')(example), 1), 1)
	const indent = Array.match(
		pipe(
			lines,
			Array.filter(line => String.isNonEmpty(String.trim(line))),
			Array.map(line => line.length - String.trimStart(line).length)
		),
		{onEmpty: () => 0, onNonEmpty: Array.min(Order.Number)}
	)
	return Array.join(Array.map(lines, String.slice(indent)), '\n')
}

export function question(kind: Kind, text: string, criteria: {message: string; no: Side; yes: Side}) {
	return {
		kind,
		message: criteria.message,
		no: {cases: criteria.no.cases, example: dedent(criteria.no.example)},
		question: text,
		yes: {cases: criteria.yes.cases, example: dedent(criteria.yes.example)}
	} satisfies Question
}
