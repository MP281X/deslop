import {Array, Option, String, Struct, pipe} from 'effect'

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

function reuseTags(tags: readonly TagName[], existing: readonly TagName[]) {
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

// The organization's tags as the tags in use spell them, each with the definition the AI gave it.
export function reconcileOrganization(organization: Organization, inUse: readonly TagName[]) {
	const tags = reuseTags(organization.tags, inUse)
	const definitions = Array.getSomes(
		Array.map(organization.definitions, item =>
			Option.map(Array.head(reuseTags(normalizeTags([item.tag]), inUse)), name => ({
				definition: Option.liftPredicate(plainText(item.definition), String.isNonEmpty),
				tag: name
			}))
		)
	)
	return {
		organization: Struct.omit(organization, ['definitions', 'tags']),
		tags: Array.map(tags, name => ({
			definition: Option.flatMap(
				Array.findFirst(definitions, item => item.tag === name),
				item => item.definition
			),
			name
		}))
	}
}
