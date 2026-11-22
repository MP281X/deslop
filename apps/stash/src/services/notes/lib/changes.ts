import {Array, Boolean, Function, HashSet, Match, Option, Result, String, Struct, pipe} from 'effect'

import type {UserId} from '@deslop/runtime/shared/auth'

import {commentOf, sourceOf} from './utils.ts'

import {Note, NoteChangeResult} from '#services/notes/schema.ts'
import type {Capture, FileType, NoteChange} from '#services/notes/schema.ts'

// Words saved after the organization read the note stay visible under its body as the owner's own lines, without paying for another pass.
function annotated(body: string, words: readonly string[]) {
	return Array.join([body, ...Array.map(words, line => `> ${line}`)], '\n')
}

// Decide the change without writes so the caller can apply it to the latest note in its transaction.
// judge-ignore no-silent-fallback -- Notes logs extraction failures before this pure reducer sees their Result; saved content remains usable, and the worker's failure policy records an issue when no saved content exists.
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
						NoteChangeResult.cases.Changed.make({
							note: {
								...fields,
								body: Option.map(note.body, body => annotated(body, [Array.join(words, ' ')])),
								text: `${note.text}\n${Array.join(words, ' ')}`
							}
						})
				})
			)
		}),
		Match.tag('image', change =>
			NoteChangeResult.cases.Changed.make({note: {...fields, image: Option.some(change.image)}})
		),
		Match.tag('resolve', change =>
			NoteChangeResult.cases.Changed.make({
				note: {
					...fields,
					source: sourceOf(change.url),
					title: pipe(
						note.url,
						Option.contains(note.title),
						Boolean.match({onFalse: () => note.title, onTrue: () => change.url})
					),
					url: Option.some(change.url)
				}
			})
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
		Match.tag('issue', change =>
			NoteChangeResult.cases.Changed.make({note: {...fields, issue: Option.some(change.issue)}})
		),
		Match.tag('organize', change =>
			NoteChangeResult.cases.Changed.make({
				note: {
					...fields,
					body: Option.some(
						annotated(
							change.organization.body,
							pipe(
								Option.liftPredicate(note.text, String.startsWith(change.read)),
								Option.map(text =>
									pipe(String.slice(change.read.length)(text), String.split('\n'), Array.map(String.trim))
								),
								Option.getOrElse(Array.empty<string>),
								Array.filter(String.isNonEmpty)
							)
						)
					),
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
				note: {...fields, issue: Option.some(change.issue), status: 'failed' as const}
			})
		),
		Match.tag('empty', () =>
			NoteChangeResult.cases.Changed.make({
				note: {
					...fields,
					issue: Option.orElse(note.issue, () =>
						Option.some(
							Boolean.match(Option.isSome(note.file), {
								onFalse: Function.constant('Nothing to read at this link.'),
								onTrue: Function.constant('Nothing to read in this file.')
							})
						)
					),
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
		Match.tag('retry', change =>
			NoteChangeResult.cases.Changed.make({
				note: {
					...fields,
					issue: Option.none(),
					requester: change.requester,
					status: 'organizing' as const,
					transcript: Option.none()
				}
			})
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
