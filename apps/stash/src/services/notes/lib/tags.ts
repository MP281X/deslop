import {Array, Option, Record, String, Struct, pipe} from 'effect'

import {plainText} from '#services/notes/lib/utils.ts'
import type {Note, Organization, TagDefinition} from '#services/notes/schema.ts'

export function normalizeTags(tags: Note['tags']) {
	return pipe(
		tags,
		Array.map(tag => pipe(tag, String.toLowerCase, plainText, String.replace(/^#+/u, ''), String.replaceAll(' ', '-'))),
		Array.filter(String.isNonEmpty),
		Array.dedupe
	)
}

// `+` and `#` name languages (c, c++, c#), and a word of three letters or fewer keeps its s (ios, aws).
function tagKey(tag: string) {
	return pipe(tag, String.replaceAll(/[^a-z0-9+#]/gu, ''), String.replace(/^(.{2,}[^s])s$/u, '$1'))
}

function reuseTags(tags: Note['tags'], existing: Note['tags']) {
	const byKey = Array.groupBy(existing, tagKey)
	return Array.dedupe(
		Array.map(tags, tag =>
			pipe(
				Array.head(byKey[tagKey(tag)] ?? []),
				Option.getOrElse(() => tag)
			)
		)
	)
}

export function reconcileOrganization(organization: Organization, inUse: string[], known: Record<string, string>) {
	const tags = reuseTags(organization.tags, inUse)
	return {
		definitions: pipe(
			organization.definitions,
			Array.map(item =>
				pipe(
					Array.head(reuseTags(normalizeTags([item.tag]), inUse)),
					Option.map(name => ({definition: plainText(item.definition), tag: name}))
				)
			),
			Array.getSomes,
			Array.filter(item => Array.contains(tags, item.tag) && !Record.has(known, item.tag))
		),
		organization: {...Struct.omit(organization, ['definitions']), tags}
	}
}

export function reconcileDefinitions(entries: TagDefinition[], known: Record<string, string>) {
	const definitions = {
		...Record.fromEntries(
			Array.map(
				Array.dedupeWith(entries, (left, right) => left.tag === right.tag),
				entry => [entry.tag, entry.definition] as const
			)
		),
		...known
	}
	return {definitions, rows: Array.map(Record.toEntries(definitions), pair => ({definition: pair[1], tag: pair[0]}))}
}
