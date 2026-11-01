import {Array, MutableList, Option, Record, Schema, String} from 'effect'

import type {Experience} from '#services/game/schema.ts'
import {LocalDecision, Point} from '#services/game/schema.ts'

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

function jsonEnd(text: string, start: number) {
	const state = {depth: 0}
	// Quoted JSON strings are whole tokens, so their braces and escaped quotes never affect nesting.
	for (const token of String.matchAll(/"(?:\\[\s\S]|[^"\\])*"|[{}[\]]/gu)(String.slice(start)(text))) {
		if (token[0] === '{' || token[0] === '[') {
			state.depth += 1
		} else if (token[0] === '}' || token[0] === ']') {
			state.depth -= 1
			if (state.depth === 0) return Option.map(Option.fromUndefinedOr(token.index), index => start + index + 1)
		}
	}
	return Option.none<number>()
}

type TextPart = {kind: 'text'; text: string} | {kind: 'data'; value: Schema.Json}

export function textParts(text: string) {
	const parts = MutableList.make<TextPart>()
	const cursor = {start: 0, through: 0}
	while (cursor.start < text.length) {
		if (text[cursor.start] === '{' || text[cursor.start] === '[') {
			const end = Option.getOrUndefined(jsonEnd(text, cursor.start))
			const value = Option.getOrUndefined(
				Option.flatMap(Option.fromUndefinedOr(end), to =>
					Schema.decodeOption(Schema.fromJsonString(Schema.Json))(String.slice(cursor.start, to)(text))
				)
			)
			if (end !== undefined && value !== undefined) {
				if (cursor.start > cursor.through) {
					MutableList.append(parts, {kind: 'text', text: String.slice(cursor.through, cursor.start)(text)})
				}
				MutableList.append(parts, {kind: 'data', value})
				cursor.start = end - 1
				cursor.through = end
			}
		}
		cursor.start += 1
	}
	if (cursor.through < text.length) MutableList.append(parts, {kind: 'text', text: String.slice(cursor.through)(text)})
	return MutableList.toArray(parts)
}

export function recordData(value: Record<string, unknown>, tick: number) {
	const at = Option.map(
		Schema.decodeUnknownOption(Schema.Struct({...Point.fields, tick: Schema.optionalKey(Schema.Int)}))(value),
		point => ({...point, tick: point.tick ?? tick})
	)
	return {
		anchor: Option.getOrUndefined(Array.findFirst(['text', '_tag', 'kind', 'name'], field => Record.has(value, field))),
		at,
		fields: Record.toEntries(
			Record.filter(value, (field, key) => field !== undefined && (Option.isNone(at) || (key !== 'x' && key !== 'z')))
		)
	}
}

export function entityField(field: string) {
	return Array.contains(['actor', 'building', 'unit', 'target', 'from', 'to', 'subject', 'source'], field)
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

export function eventModel(entry: Experience, models: readonly string[]) {
	return Option.getOrElse(
		Option.filter(
			Option.flatMap(String.match(/^(\w+) #-?\d+:/u)(entry.text), found => Option.fromUndefinedOr(found[1])),
			name => Array.contains(models, name)
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
