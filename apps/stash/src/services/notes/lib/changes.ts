import {Array, Boolean, Function, HashSet, Match, Option, Result, String, Struct, pipe} from 'effect'

import type {UserId} from '@deslop/runtime/shared/auth'

import {commentOf, sourceOf} from './utils.ts'

import {Note, NoteChangeResult} from '#services/notes/schema.ts'
import type {Capture, FileType, NoteChange} from '#services/notes/schema.ts'

export function changeNote(note: Note, update: NoteChange) {
	const fields = Struct.pick(note, Struct.keys(Note.fields))
	return pipe(
		Match.value(update),
		Match.tag('remove', () => NoteChangeResult.cases.Removed.make({})),
		Match.tag('share', change => {
			if (note.id === change.capture.id) return NoteChangeResult.cases.Unchanged.make({})
			const known = HashSet.fromIterable(pipe(note.text, String.toLowerCase, String.split(/\s+/u)))

			return pipe(
				commentOf(change.capture.text),
				String.split(' '),
				Array.filter(word => String.isNonEmpty(word) && !HashSet.has(known, String.toLowerCase(word))),
				Array.match({
					onEmpty: () => NoteChangeResult.cases.Unchanged.make({}),
					onNonEmpty: words =>
						NoteChangeResult.cases.Changed.make({note: {...fields, text: `${note.text}\n${Array.join(words, ' ')}`}})
				})
			)
		}),
		Match.tag('image', change =>
			NoteChangeResult.cases.Changed.make({note: {...fields, image: Option.some(change.image)}})
		),
		Match.tag('extract', change =>
			Result.match(change.extraction, {
				onFailure: error =>
					Boolean.match(String.isEmpty(note.content), {
						onFalse: () => NoteChangeResult.cases.Unchanged.make({}),
						onTrue: () => NoteChangeResult.cases.Changed.make({note: {...fields, issue: Option.some(error.message)}})
					}),
				onSuccess: page =>
					NoteChangeResult.cases.Changed.make({
						note: {
							...fields,
							author: pipe(
								page.author,
								Option.filter(String.isNonEmpty),
								Option.orElse(() => note.author)
							),
							content: page.text,
							issue: Option.none(),
							title: Boolean.match(String.isNonEmpty(page.title) && Option.contains(note.url, note.title), {
								onFalse: () => note.title,
								onTrue: () => page.title
							})
						}
					})
			})
		),
		Match.tag('video', change =>
			NoteChangeResult.cases.Changed.make({
				note: {
					...fields,
					content: Option.getOrElse(change.content, () => note.content),
					issue: Boolean.match(Option.isSome(change.content), {onFalse: () => note.issue, onTrue: Option.none}),
					transcript: Option.orElse(change.transcript, () => note.transcript)
				}
			})
		),
		Match.tag('organize', change =>
			NoteChangeResult.cases.Changed.make({
				note: {
					...fields,
					body: Option.some(change.organization.body),
					issue: Option.none(),
					screenText: Option.some(change.organization.screenText),
					status: 'ready' as const,
					summary: change.organization.summary,
					title: change.organization.title,
					topics: Option.some(change.organization.topics)
				}
			})
		),
		Match.tag('fail', change =>
			NoteChangeResult.cases.Changed.make({
				note: {...fields, issue: Option.some(change.message), status: 'failed' as const}
			})
		),
		Match.tag('empty', () =>
			NoteChangeResult.cases.Changed.make({
				note: {
					...fields,
					issue: Option.orElse(note.issue, () => Option.some('Nothing to read at this link.')),
					status: 'failed' as const
				}
			})
		),
		Match.tag('stop', () =>
			Boolean.match(note.status === 'organizing', {
				onFalse: () => NoteChangeResult.cases.Unchanged.make({}),
				onTrue: () =>
					NoteChangeResult.cases.Changed.make({
						note: {...fields, issue: Option.some('Tagging stopped before it finished.'), status: 'failed' as const}
					})
			})
		),
		Match.tag('retry', () =>
			NoteChangeResult.cases.Changed.make({
				note: {...fields, issue: Option.none(), status: 'organizing' as const, transcript: Option.none()}
			})
		),
		Match.tag('request', change =>
			NoteChangeResult.cases.Changed.make({note: {...fields, requester: change.requester}})
		),
		Match.exhaustive
	)
}

export function newNote(requester: UserId, input: Capture, url: Option.Option<string>, file: Option.Option<FileType>) {
	return {
		author: Option.none(),
		body: Option.none(),
		content: '',
		file,
		id: input.id,
		image: Option.filter(file, type => type === 'image/jpeg'),
		issue: Option.none(),
		requester,
		screenText: Option.none(),
		source: Option.match(url, {onNone: Function.constant('Note' as const), onSome: sourceOf}),
		status: 'organizing' as const,
		summary: '',
		text: String.trim(input.text),
		title: Option.match(file, {
			onNone: () =>
				pipe(
					Option.liftPredicate(commentOf(input.text), String.isNonEmpty),
					Option.orElse(() => url),
					Option.getOrElse(() => input.text),
					String.slice(0, 200)
				),
			onSome: type =>
				Boolean.match(type === 'image/jpeg', {onFalse: Function.constant('video'), onTrue: Function.constant('image')})
		}),
		topics: Option.none(),
		transcript: Option.none(),
		url
	} satisfies Omit<typeof Note.insert.Type, 'createdAt'>
}
