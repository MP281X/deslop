import {Array, Clock, Effect, Function, Match, Option, Schema, String, pipe} from 'effect'

import {Atom} from 'effect/reactivity'
import {Directory, File} from 'expo-file-system'
import {Alert} from 'react-native'

import {activationsAtom} from '@deslop/runtime/mobile/activations'

import {session} from '#lib/session.ts'
import {native} from '#modules/native/index.ts'
import {NotesError} from '#services/notes/schema.ts'

// What answered a queued share, as the share extension or the app's background wake recorded it: status 0 when no answer came.
type Outcome = typeof Outcome.Type
const Outcome = Schema.fromJsonString(Schema.Struct({message: Schema.String, status: Schema.Finite}))

// A body the extension queued names its capture id and what it holds.
function routeOf(name: string) {
	return pipe(
		String.match(/^([\da-f-]{36})\.(json|jpg|mp4|mov)$/u)(name),
		Option.flatMap(match => Option.all({extension: Array.get(match, 2), id: Array.get(match, 1)})),
		Option.map(body =>
			pipe(
				Match.value(body.extension),
				Match.when('json', () => ({path: '/api/capture', type: 'application/json'})),
				Match.when('jpg', () => ({path: `/api/files/${body.id}`, type: 'image/jpeg'})),
				Match.when('mp4', () => ({path: `/api/files/${body.id}`, type: 'video/mp4'})),
				Match.orElse(() => ({path: `/api/files/${body.id}`, type: 'video/quicktime'}))
			)
		)
	)
}

// Accepted, or accepted and deleted since.
function accepted(status: number) {
	return (status >= 200 && status < 300) || status === 410
}

// A refusal sending again cannot change; a refused sign-in can, from the app's current session.
function final(status: number) {
	return status >= 400 && status < 500 && status !== 401 && status !== 403
}

function remove(files: readonly File[]) {
	return Effect.ignore(
		Effect.try({
			catch: cause => NotesError.make({cause, message: 'A sent share could not be removed from this iPhone.'}),
			try: () =>
				Array.forEach(files, file => {
					if (file.exists) file.delete()
				})
		}),
		{log: 'Warn', message: 'A sent share stays on this iPhone'}
	)
}

// A share the server can never take is said once, with the server's reason, and then let go.
function refused(message: string, files: readonly File[]) {
	return Effect.andThen(
		Effect.sync(() =>
			Alert.alert(
				'Share Not Saved',
				pipe(
					String.trim(message),
					Option.liftPredicate(String.isNonEmpty),
					Option.getOrElse(Function.constant('Stash refused a share.'))
				)
			)
		),
		remove(files)
	)
}

// The server's answer decides: accepted or since deleted lets the share go; refused for good is said; no answer, a server error or a refused sign-in is sent again from the app, whose session is current.
const settle = Effect.fnUntraced(function* (body: File, now: number) {
	const outcomeFile = new File(body.parentDirectory, `${body.name}.outcome`)
	const outcome = yield* pipe(
		Effect.try({
			catch: cause => NotesError.make({cause, message: 'The answer to a share could not be read.'}),
			try: () => Option.liftPredicate(outcomeFile, file => file.exists)
		}),
		Effect.flatMap(
			Option.match({
				onNone: () => Effect.succeedNone,
				onSome: file => Effect.option(Schema.decodeEffect(Outcome)(file.textSync()))
			})
		),
		Effect.option,
		Effect.map(Option.flatten)
	)
	const files = [body, outcomeFile]
	if (Option.exists(outcome, answer => accepted(answer.status))) return yield* remove(files)
	if (Option.exists(outcome, answer => final(answer.status))) {
		return yield* refused(
			Option.match(outcome, {onNone: Function.constant(''), onSome: answer => answer.message}),
			files
		)
	}
	// Without an answer, iOS may still be sending it for up to a day.
	const queued = yield* Effect.try({
		catch: cause => NotesError.make({cause, message: 'A queued share could not be read.'}),
		try: () => body.info().modificationTime ?? now
	})
	if (Option.isNone(outcome) && now - queued < 86_400_000) return
	const route = yield* Effect.fromOption(routeOf(body.name))
	const headers = yield* session.headers
	const answer = yield* Effect.tryPromise({
		catch: cause => NotesError.make({cause, message: 'A queued share could not be sent again.'}),
		try: signal =>
			body.upload(new URL(route.path, session.server).href, {
				headers: {...headers, 'content-type': route.type},
				httpMethod: 'POST',
				signal
			})
	})
	if (accepted(answer.status)) return yield* remove(files)
	if (answer.status >= 400 && answer.status < 500) return yield* refused(answer.body, files)
})

// Each return to Stash settles the shares the extension queued while the app was away.
export const sharesAtom = Atom.make(get => {
	get(activationsAtom)
	const admitted = Option.isSome(session.admitted(get))
	return Effect.gen(function* () {
		const uri = native.sharedUploads()
		if (!admitted || uri === null) return
		const folder = new Directory(uri)
		if (!folder.exists) return
		const now = yield* Clock.currentTimeMillis
		yield* pipe(
			folder.list(),
			Array.filter((entry): entry is File => entry instanceof File && Option.isSome(routeOf(entry.name))),
			Effect.forEach(
				body => Effect.ignore(settle(body, now), {log: 'Warn', message: 'A queued share was not settled'}),
				{concurrency: 1, discard: true}
			)
		)
	})
})
