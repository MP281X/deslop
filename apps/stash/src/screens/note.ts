import {MarkdownParser} from '@effect/ui/html'

import {Array, Boolean, DateTime, Duration, Function, Option, Result, String, pipe} from 'effect'

import {ageOf, dayOf} from '@deslop/runtime/shared/format'

import type {NoteItem} from '#contracts'

import {sourceLabelOf, subjectOf} from '#screens/kinds.ts'
import {webLinksOnly} from '#screens/markdown.ts'
import {pagesOf} from '#screens/pages.ts'

export function savedOf(note: NoteItem, now: DateTime.Utc) {
	if (pipe(note.createdAt, DateTime.distance(now), Duration.isLessThan(Duration.days(1)))) {
		return ageOf(note.createdAt, now)
	}
	return dayOf(note.createdAt, now)
}

export function issueOf(note: NoteItem) {
	return Option.getOrElse(note.issue, () => `Couldn’t read this ${subjectOf(note)}`)
}

export function rowOf(note: NoteItem, now: DateTime.Utc) {
	return {
		id: note.id,
		line: Boolean.match(note.status === 'organizing', {
			onFalse: () => pipe([sourceLabelOf(note), note.summary], Array.filter(String.isNonEmpty), Array.join(' · ')),
			onTrue: () => `Reading this ${subjectOf(note)}`
		}),
		...Boolean.match(note.status === 'failed', {
			onFalse: () => ({}),
			onTrue: () => ({problem: {reason: issueOf(note), status: 'error' as const}})
		}),
		title: note.title,
		trailing: savedOf(note, now)
	}
}

export function pathsOf(note: NoteItem, count: number) {
	return Array.map(pagesOf(Option.isSome(note.image), note.id, count), page => {
		if (page.kind === 'cover') return `/api/images/${note.id}`
		return `/api/notes/${page.path}`
	})
}

export function isWebLink(url: string) {
	return Option.isSome(String.match(/^https?:\/\//iu)(url))
}

export function parseBody(body: string) {
	return Result.map(
		Result.try({catch: Function.identity, try: () => MarkdownParser.parseMarkdown(webLinksOnly(body))}),
		document => ({blocks: document.blocks})
	)
}
