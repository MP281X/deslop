import {Array, Predicate, String, pipe} from 'effect'

import type {Note} from '#services/notes/schema.ts'

export function findNotes(notes: Note[], query: string) {
	const words = pipe(query, String.toLowerCase, String.split(/\s+/u), Array.filter(String.isNonEmpty))
	const tags = pipe(
		words,
		Array.filter(String.startsWith('#')),
		Array.map(String.slice(1)),
		Array.filter(String.isNonEmpty)
	)
	const terms = Array.filter(words, word => !String.startsWith('#')(word))
	if (Array.isReadonlyArrayEmpty(words)) return notes
	return Array.filter(notes, note => {
		if (!Array.every(tags, tag => Array.contains(note.tags, tag))) return false
		const haystack = pipe(
			[
				note.title,
				note.summary,
				note.author,
				note.text,
				note.content,
				note.topics,
				note.body,
				note.screenText,
				note.transcript,
				note.url,
				...note.tags
			],
			Array.filter(Predicate.isNotUndefined),
			Array.join(' '),
			String.toLowerCase
		)
		return Array.every(terms, term => String.includes(term)(haystack))
	})
}
