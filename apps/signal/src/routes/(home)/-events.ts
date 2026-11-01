import {Array, Option, Record, Schema, String} from 'effect'

import type {Experience} from '#services/game/schema.ts'
import {LocalDecision} from '#services/game/schema.ts'

function decisionKey(entry: Experience) {
	if (entry.kind !== 'decision') return Option.none<string>()
	return Option.map(
		String.match(/^(?:Chose (\S+): |Model returned (\S+); a response does not prove execution\.$)/u)(entry.text),
		match => `${entry.actor}:${entry.tick}:${match[1] ?? match[2]}`
	)
}

// Only an unambiguous applied-choice/response pair is one presentation row. Originals remain in history.
export function displayEvents(entries: readonly Experience[]) {
	const pairs = Array.groupBy(entries, entry => Option.getOrElse(decisionKey(entry), () => `event:${entry.id}`))
	return Array.flatMap(entries, entry => {
		const pair = pairs[Option.getOrElse(decisionKey(entry), () => `event:${entry.id}`)] ?? []
		const chosen = Array.filter(pair, value => value.context === undefined && String.startsWith('Chose ')(value.text))
		const receipts = Array.filter(
			pair,
			value => value.context !== undefined && String.startsWith('Model returned ')(value.text)
		)
		if (pair.length !== 2 || chosen.length !== 1 || receipts.length !== 1) return [entry]
		if (entry.context !== undefined) return []
		return [{...entry, context: receipts[0]?.context, tokens: receipts[0]?.tokens}]
	})
}

export function decisionDetails(context: string) {
	return Schema.decodeOption(Schema.fromJsonString(LocalDecision))(context)
}

function jsonValue(text: string) {
	return Schema.decodeOption(Schema.fromJsonString(Schema.Json))(text)
}

export function jsonParts(text: string) {
	return Option.orElse(
		Option.map(jsonValue(text), value => ({before: '', value})),
		() =>
			Option.flatMap(String.match(/^(.*?)(\{.*\}|\[.*\])\.?$/u)(text), found =>
				Option.map(jsonValue(found[2] ?? ''), value => ({before: found[1] ?? '', value}))
			)
	)
}

export function fieldName(name: string) {
	if (name === '_tag') return 'Action'
	return String.capitalize(
		String.toLowerCase(String.replaceAll(/[_-]/gu, ' ')(String.replaceAll(/([a-z])([A-Z])/gu, '$1 $2')(name)))
	)
}

export function actorName(kind: string, id: number) {
	if (kind === 'home') return 'Core'
	if (kind === 'worker') return `Builder #${id}`
	if (id >= 1_000_000_000) return fieldName(kind)
	return `${fieldName(kind)} #${id}`
}

export function eventModel(entry: Experience, models: Record<string, string>) {
	return Option.getOrElse(
		Option.filter(
			Option.flatMap(String.match(/^(\w+) #-?\d+:/u)(entry.text), found => Option.fromUndefinedOr(found[1])),
			name => Record.has(models, name)
		),
		() => entry.actorKind ?? 'unknown'
	)
}

export function eventText(entry: Experience) {
	if (entry.kind !== 'decision') return entry.text
	const response = Option.getOrUndefined(
		String.match(/^Model returned (\S+); a response does not prove execution\.$/u)(entry.text)
	)
	if (response !== undefined) {
		const choice = response[1] ?? 'unknown'
		return `Model selected: ${Option.getOrElse(
			Option.flatMap(Option.flatMap(Option.fromUndefinedOr(entry.context), decisionDetails), request =>
				Record.get(request.choices, choice)
			),
			() => fieldName(choice)
		)}`
	}
	return String.replace(/^Chose [^\s:]+(?::-?\d+)?: /u, 'Selected: ')(entry.text)
}
