import {Array, Function, Order, String, pipe} from 'effect'

import type {Features} from '#lib/features.ts'

export type Kind = 'code' | 'component' | 'test'

export type Side = {cases: Array.NonEmptyReadonlyArray<string>; example: string}

// One narrow yes-or-no question about `code`, asked of every unit of its kind that its `gate` admits: `yes` is the violation, `message` tells the agent the fix, and the judge checks it answers its own examples. A gate reads only what Jev reads and must hold for every unit the answer could be yes for; without one, every unit is asked.
export type Question = {
	gate: (unit: Features) => boolean
	kind: Kind
	message: string
	no: Side
	question: string
	yes: Side
}

// An example is written indented inside its question; Jev reads it without the opening and closing lines and their shared indent.
function dedent(example: string) {
	const lines = pipe(String.split(example, '\n'), Array.drop(1), Array.dropRight(1))
	const indent = Array.match(
		pipe(
			lines,
			Array.filter(line => String.isNonEmpty(String.trim(line))),
			Array.map(line => line.length - String.trimStart(line).length)
		),
		{onEmpty: () => 0, onNonEmpty: Array.min(Order.Number)}
	)
	return pipe(lines, Array.map(String.slice(indent)), Array.join('\n'))
}

export function question(
	kind: Kind,
	text: string,
	criteria: {gate?: (unit: Features) => boolean; message: string; no: Side; yes: Side}
) {
	return {
		gate: criteria.gate ?? Function.constTrue,
		kind,
		message: criteria.message,
		no: {cases: criteria.no.cases, example: dedent(criteria.no.example)},
		question: text,
		yes: {cases: criteria.yes.cases, example: dedent(criteria.yes.example)}
	} satisfies Question
}
