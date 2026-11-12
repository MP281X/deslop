import {Array, Option, Record, String, Struct, pipe} from 'effect'

import {plainText} from '#services/notes/lib/utils.ts'
import type {Organization, TagName} from '#services/notes/schema.ts'

export function normalizeTags(tags: readonly TagName[]) {
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

// A tag as the tags in use spell it, when one shares its key.
function spelled(byKey: Record.ReadonlyRecord<string, Array.NonEmptyArray<TagName>>, tag: TagName) {
	return Option.match(Record.get(byKey, tagKey(tag)), {onNone: () => tag, onSome: Array.headNonEmpty})
}

// The organization's tags as the tags in use spell them, each with the first definition the AI gave it.
export function reconcileOrganization(organization: Organization, inUse: readonly TagName[]) {
	const byKey = Array.groupBy(inUse, tagKey)
	// Read from the last, so the first definition of a tag is the one kept.
	const definitions = Record.fromEntries(
		Array.reverse(
			Array.getSomes(
				Array.map(organization.definitions, item =>
					Option.map(
						Array.head(normalizeTags([item.tag])),
						tag => [spelled(byKey, tag), Option.liftPredicate(plainText(item.definition), String.isNonEmpty)] as const
					)
				)
			)
		)
	)
	return {
		organization: Struct.omit(organization, ['definitions', 'tags']),
		tags: Array.map(Array.dedupe(Array.map(organization.tags, tag => spelled(byKey, tag))), name => ({
			definition: Option.flatten(Record.get(definitions, name)),
			name
		}))
	}
}
