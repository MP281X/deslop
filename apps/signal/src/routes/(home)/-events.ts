import {Array, Boolean, Equal, MutableList, Number, Option, Record, Schema, String} from 'effect'

import type {Entry} from '#services/game/schema.ts'
import {Experience, LocalDecision, Point} from '#services/game/schema.ts'

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

type RecordedMember = typeof RecordedMember.Type
const RecordedMember = Schema.Struct({
	id: Schema.Int,
	kind: Schema.String,
	x: Schema.optionalKey(Schema.Finite),
	z: Schema.optionalKey(Schema.Finite)
})
type DecisionState = typeof DecisionState.Type
const DecisionState = Schema.Struct({
	facts: Schema.optionalKey(Schema.Array(RecordedMember)),
	self: Schema.optionalKey(RecordedMember)
})
type StateRecord = typeof StateRecord.Type
const StateRecord = Schema.Record(Schema.String, Schema.Unknown)

// Local receipts contain their full continuation followed by the recorded state on its own line.
export function requestState(request: LocalDecision) {
	return Option.orElse(Schema.decodeOption(Schema.fromJsonString(StateRecord))(request.state), () =>
		Option.flatMap(Array.last(String.split('\n')(request.state)), line =>
			Schema.decodeOption(Schema.fromJsonString(StateRecord))(line)
		)
	)
}

export function requestContinuation(request: LocalDecision) {
	if (Option.isNone(requestState(request))) return ''
	if (Option.isSome(Schema.decodeOption(Schema.fromJsonString(StateRecord))(request.state))) return ''
	const prefix = String.slice(0, Option.getOrElse(String.lastIndexOf('\n')(request.state), () => -1) + 1)(request.state)
	return String.trim(
		String.replaceAll(
			/Tick \d+\. Private experiences:\n(?=\n|$)/gu,
			''
		)(
			Array.reduce(request.experience ?? [], prefix, (text, entry) =>
				String.replaceAll(
					`[${entry.id}; tick ${entry.tick}; ${entry.kind}; (${entry.x}, ${entry.z})] ${entry.text}\n`,
					''
				)(text)
			)
		)
	)
}

// Only recorded identities, not the present world's membership, identify remembered subjects.
export function requestMembers(request: LocalDecision, known: Record<string, {kind: string; team?: number}> = {}) {
	return Option.match(Option.flatMap(requestState(request), Schema.decodeUnknownOption(DecisionState)), {
		onNone: () => Record.empty<string, {kind: string; x?: number; z?: number}>(),
		onSome: state =>
			Record.fromEntries(
				Array.map([...Option.toArray(Option.fromUndefinedOr(state.self)), ...(state.facts ?? [])], member => [
					`${member.id}`,
					{...known[member.id], kind: member.kind, x: member.x, z: member.z}
				])
			)
	})
}

export function requestMemory(request: LocalDecision) {
	const recent = Option.getOrUndefined(Option.flatMap(requestState(request), state => Record.get(state, 'recent')))
	if (recent === undefined) return []
	return Array.filter(
		Boolean.match(Array.isArray(recent), {onFalse: () => [recent], onTrue: () => Array.ensure(recent)}),
		entry =>
			!Array.some(
				request.experience ?? [],
				experience =>
					Equal.equals(entry, experience) ||
					(Schema.is(Schema.Struct({id: Schema.Int}))(entry) &&
						Record.keys(entry).length === 1 &&
						entry.id === experience.id)
			)
	)
}

export function actorKind(entry: Experience, members: Record<string, {kind: string}>) {
	return (
		entry.actorKind ??
		Option.getOrUndefined(
			Option.flatMap(Option.flatMap(Option.fromUndefinedOr(entry.context), decisionDetails), request =>
				Record.get(requestMembers(request), `${entry.actor}`)
			)
		)?.kind ??
		members[entry.actor]?.kind ??
		'individual'
	)
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
	const experience = Schema.decodeUnknownOption(Experience)(value)
	const entity = Option.match(experience, {
		onNone: () => Schema.decodeUnknownOption(RecordedMember)(value),
		onSome: () => Option.none<RecordedMember>()
	})
	const at = Option.map(
		Schema.decodeUnknownOption(Schema.Struct({...Point.fields, tick: Schema.optionalKey(Schema.Int)}))(value),
		point => ({...point, tick: point.tick ?? tick})
	)
	return {
		anchor: Option.getOrUndefined(
			Array.findFirst(
				['text', 'doing', '_tag', 'kind', 'name'],
				field => Record.has(value, field) && (Option.isNone(entity) || field !== 'kind')
			)
		),
		at,
		fields: Record.toEntries(
			Record.filter(
				value,
				(field, key) =>
					field !== undefined &&
					key !== 'id' &&
					key !== 'tokens' &&
					(Option.isNone(experience) || key !== 'actor') &&
					(Option.isNone(entity) || key !== 'kind') &&
					(Option.isNone(at) || (key !== 'x' && key !== 'z'))
			)
		),
		identity: Option.map(
			Option.orElse(
				Option.map(experience, entry => ({id: entry.actor, kind: entry.actorKind})),
				() => entity
			),
			member => ({
				fallback: Option.getOrUndefined(at),
				id: member.id,
				kind: member.kind,
				tick: Option.getOrElse(
					Option.map(at, point => point.tick),
					() => tick
				)
			})
		),
		reference: Record.keys(value).length === 1 && Record.has(value, 'id')
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

// Explicit subject metadata wins. Older decision records encode their target in the selected choice.
export function eventSubject(entry: Experience) {
	return (
		entry.subject ??
		Option.getOrElse(
			Option.flatMap(
				Option.flatMap(
					String.match(
						/^(?:Chose |Model returned )(?:approach|attack|build|deposit|inspect|repair|take|report):(-?\d+)(?::|;)/u
					)(entry.text),
					match => Option.fromUndefinedOr(match[1])
				),
				Number.parse
			),
			() => entry.actor
		)
	)
}

// A preview ends where structured arguments start, even when an unreadable call contains malformed JSON.
function compactText(text: string) {
	return String.trim(
		Option.getOrElse(
			Array.head(
				String.split(/[[{]/u)(
					Option.getOrElse(
						Array.findFirst(String.split('\n')(text), line => String.isNonEmpty(String.trim(line))),
						() => ''
					)
				)
			),
			() => ''
		)
	)
}

export function eventSummary(entry: Experience) {
	return compactText(eventText(entry)) || fieldName(entry.kind)
}

export function roundSummary(entry: Pick<Entry, 'commands' | 'text'>) {
	return {
		failed: Array.countBy(entry.commands, outcome => !outcome.ok),
		text: compactText(entry.text) || 'Response data',
		unreadable: Array.countBy(String.split('\n')(entry.text), line => String.startsWith('Unreadable tool call:')(line))
	}
}

function routineObservation(entry: Experience) {
	if (entry.kind === 'born') return true
	if (entry.kind !== 'observe') return false
	return Option.isSome(String.match(/^(?:\w+ #-?\d+: idle$|An uninspected |\w+ field at \()/u)(entry.text))
}

// Only routine observations are bundled; inspections, changed storage, construction and failures stay visible.
export function sameObservationGroup(left: Experience, right: Experience) {
	return left.tick === right.tick && routineObservation(left) && routineObservation(right)
}
