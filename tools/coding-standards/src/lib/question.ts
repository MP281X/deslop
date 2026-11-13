import {Array, Function, Order, Record, String, pipe} from 'effect'

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

// What Jev reads of the change for each kind of change question: one diff hunk alone, one hunk beside what the change says it does, or one claim beside the proof offered for it.
export type ChangeStates = {
	claim: {claim: string; proof: string}
	edit: {edit: string; file: string}
	scope: {edit: string; file: string; request: string}
}

// One yes-or-no question about the change, asked of every hunk or claim of its kind; its examples are whole states, so the judge asks them exactly as it asks the change.
export type ChangeQuestion = {
	[K in keyof ChangeStates]: {
		kind: K
		message: string
		no: {cases: Array.NonEmptyReadonlyArray<string>; example: ChangeStates[K]}
		question: string
		yes: {cases: Array.NonEmptyReadonlyArray<string>; example: ChangeStates[K]}
	}
}[keyof ChangeStates]

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

// A field written as an indented block opens with a line break; a one-line field is read as written.
function dedentFields(state: Record<string, string>) {
	return Record.map(state, value => {
		if (!String.startsWith('\n')(value)) return value
		return dedent(value)
	})
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

export function changeQuestion<K extends keyof ChangeStates>(
	kind: K,
	text: string,
	criteria: {
		message: string
		no: {cases: Array.NonEmptyReadonlyArray<string>; example: ChangeStates[K]}
		yes: {cases: Array.NonEmptyReadonlyArray<string>; example: ChangeStates[K]}
	}
) {
	return {
		kind,
		message: criteria.message,
		no: {cases: criteria.no.cases, example: dedentFields(criteria.no.example)},
		question: text,
		yes: {cases: criteria.yes.cases, example: dedentFields(criteria.yes.example)}
	}
}
