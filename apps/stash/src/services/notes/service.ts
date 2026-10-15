import {
	Array,
	Boolean,
	ByteSize,
	Cause,
	Config,
	Context,
	DateTime,
	Effect,
	FiberMap,
	FileSystem,
	Layer,
	Option,
	Path,
	Random,
	Result,
	Schema,
	Semaphore,
	Stream,
	String,
	Struct,
	SubscriptionRef,
	Tuple,
	pipe
} from 'effect'

import {Media} from '#services/media/service.ts'
import {Sources} from '#services/notes/lib/extraction.ts'
import {Organizer} from '#services/notes/lib/organization.ts'
import {openStore} from '#services/notes/lib/store.ts'
import {captureUrl, commentFor, diff, findNotes, hasVideo, sourceFor, tagCounts} from '#services/notes/lib/utils.ts'
import type {Capture, Extraction, FileType, Image, NotesEvent} from '#services/notes/schema.ts'
import {ImageType, Note, NotesError} from '#services/notes/schema.ts'

function withWords(note: Note, text: string) {
	const known = pipe(note.text, String.toLowerCase, String.split(/\s+/u))
	const added = pipe(
		commentFor(text),
		String.split(' '),
		Array.filter(word => String.isNonEmpty(word) && !Array.contains(known, String.toLowerCase(word)))
	)
	if (Array.isReadonlyArrayEmpty(added)) return note
	return {...note, text: `${note.text}\n${Array.join(added, ' ')}`}
}

function still(bytes: Uint8Array) {
	return {bytes, type: 'image/jpeg'} satisfies Image
}

const isVideo = String.startsWith('video/')

function changeNote(notes: Note[], id: Note['id'], change: (note: Note) => Note) {
	return Array.map(notes, note => Boolean.match(note.id === id, {onFalse: () => note, onTrue: () => change(note)}))
}

function optional<B>(message: string, fallback: () => B) {
	return <A, E, R>(effect: Effect.Effect<A, E, R>) =>
		pipe(
			effect,
			Effect.tapError(error => Effect.logWarning(message, error)),
			Effect.orElseSucceed(fallback)
		)
}

function skip(message: string) {
	return <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.catch(effect, error => Effect.logWarning(message, error))
}

export class Notes extends Context.Service<
	Notes,
	{
		readonly capture: (input: Capture) => Effect.Effect<Note, NotesError>
		readonly captureFile: (input: {
			body: Stream.Stream<Uint8Array, unknown>
			id: Note['id']
			type: FileType
		}) => Effect.Effect<Note, NotesError>
		readonly changes: Stream.Stream<Note[]>
		readonly events: Stream.Stream<NotesEvent>
		readonly get: (input: Pick<Note, 'id'>) => Effect.Effect<Note, NotesError>
		readonly image: (id: Note['id']) => Effect.Effect<Image, NotesError>
		readonly regenerate: (input: Pick<Note, 'id'>) => Effect.Effect<void, NotesError>
		readonly remove: (input: Pick<Note, 'id'>) => Effect.Effect<void, NotesError>
		readonly search: (input: {query: string}) => Effect.Effect<Note['id'][]>
	}
>()('@deslop/stash/services/notes/service/Notes') {
	static readonly layer = Layer.effect(
		this,
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const sources = yield* Sources
			const media = yield* Media
			const organizer = yield* Organizer
			const directory = yield* pipe(
				Config.String('STASH_DATA_DIR'),
				Config.withDefault(path.join(yield* Config.String('HOME'), '.deslop', 'stash'))
			)
			const images = path.join(directory, 'images')
			const files = path.join(directory, 'files')
			const reading = yield* Semaphore.make(2)
			const runs = yield* FiberMap.make<Note['id']>()
			const storageFailed = Effect.mapError(cause =>
				NotesError.make({cause, message: 'The notes database or files could not be read or written.'})
			)

			yield* pipe(fs.makeDirectory(images, {mode: 0o700, recursive: true}), storageFailed)
			yield* pipe(fs.makeDirectory(files, {mode: 0o700, recursive: true}), storageFailed)
			const store = yield* openStore(path.join(directory, 'stash.db'))
			const state = yield* SubscriptionRef.make(yield* store.load)

			function transact<A>(change: (current: Note[]) => [A, Note[]]) {
				return Effect.uninterruptible(
					SubscriptionRef.modifyEffect(state, current => {
						const result = change(current)
						if (result[1] === current) return Effect.succeed(result)
						return Effect.as(store.save(current, result[1]), result)
					})
				)
			}

			function updateNote(id: Note['id'], change: (note: Note) => Note) {
				return transact(current => Tuple.make(undefined, changeNote(current, id, change)))
			}

			function findNote(id: Note['id']) {
				return Effect.map(SubscriptionRef.get(state), notes => Array.findFirst(notes, note => note.id === id))
			}

			const storeImage = Effect.fnUntraced(function* (id: Note['id'], image: Image) {
				yield* pipe(fs.writeFile(path.join(images, id), image.bytes, {mode: 0o600}), storageFailed)
				yield* updateNote(id, note => ({...note, image: image.type}))
			})

			const tagNote = Effect.fnUntraced(function* (note: Note, stills: Image[]) {
				const id = note.id
				const preview = yield* pipe(
					Effect.forEach(Option.toArray(Option.fromNullishOr(note.image)), type =>
						Effect.map(fs.readFile(path.join(images, id)), bytes => ({bytes, type}))
					),
					optional('The preview could not be read', Array.empty<Image>)
				)
				const pictures = [...preview, ...stills]
				if (
					String.isEmpty(note.content) &&
					String.isEmpty(note.transcript ?? '') &&
					String.isEmpty(commentFor(note.text)) &&
					Array.isReadonlyArrayEmpty(pictures)
				) {
					return yield* updateNote(id, item => ({
						...item,
						issue: Boolean.match(String.isEmpty(item.issue), {
							onFalse: () => item.issue,
							onTrue: () => 'Nothing to read at this link.'
						}),
						status: 'failed'
					}))
				}
				const outcome = yield* Effect.result(
					organizer.organize({
						images: pictures,
						note,
						tags: Array.map(tagCounts(yield* SubscriptionRef.get(state)), entry => entry.tag)
					})
				)
				yield* updateNote(id, item =>
					Result.match(outcome, {
						onFailure: error => ({...item, issue: error.message, status: 'failed' as const}),
						onSuccess: organization => ({...item, ...organization, status: 'ready' as const})
					})
				)
			})

			function tag(id: Note['id'], stills: Image[]) {
				return Effect.flatMap(
					findNote(id),
					Option.match({onNone: () => Effect.void, onSome: note => tagNote(note, stills)})
				)
			}

			// TikTok's preview image links expire within days, so the server keeps the image; a regenerated note keeps its own.
			const keepImages = Effect.fnUntraced(function* (note: Note, page: Extraction) {
				yield* pipe(
					Effect.forEach(
						Option.toArray(Option.filter(page.image, () => note.image === undefined)),
						image => Effect.flatMap(sources.image(image), bytes => storeImage(note.id, bytes)),
						{discard: true}
					),
					skip('The preview image was not kept')
				)
				const slides = yield* Effect.forEach(page.slides ?? [], image =>
					pipe(sources.image(image), Effect.asSome, optional('A slide was not read', Option.none<Image>))
				)
				return Array.getSomes(slides)
			})

			const organizeLink = Effect.fnUntraced(function* (note: Note, link: string) {
				const extraction = yield* Effect.result(sources.extract(link))
				yield* updateNote(note.id, item =>
					Result.match(extraction, {
						onFailure: error => ({
							...item,
							issue: Boolean.match(String.isEmpty(item.content), {
								onFalse: () => item.issue,
								onTrue: () => error.message
							})
						}),
						onSuccess: page => ({
							...item,
							author: page.author,
							content: page.text,
							issue: '',
							title: Boolean.match(String.isNonEmpty(page.title) && item.title === item.url, {
								onFalse: () => item.title,
								onTrue: () => page.title
							})
						})
					})
				)
				const slides = yield* Result.match(extraction, {
					onFailure: () => Effect.succeed(Array.empty<Image>()),
					onSuccess: page => keepImages(note, page)
				})
				// A video site can refuse the page reader and still answer yt-dlp.
				const url = Result.match(extraction, {onFailure: () => link, onSuccess: page => page.url})
				if (!hasVideo(url)) return yield* tag(note.id, slides)
				const video = Result.match(extraction, {onFailure: () => link, onSuccess: page => page.video ?? page.url})
				const read = yield* pipe(media.read(video), Effect.asSome, optional('The video could not be read', Option.none))
				const transcript = yield* pipe(
					Option.filter(read, () => note.transcript === undefined),
					Option.map(details => pipe(details.transcript, optional('No transcript', Option.none<string>))),
					Effect.transposeOption,
					Effect.map(Option.flatten)
				)
				yield* updateNote(note.id, item => ({
					...item,
					...Option.match(
						Option.filter(read, () => sourceFor(url) !== 'X' || Result.isFailure(extraction)),
						{onNone: () => ({}), onSome: details => ({content: details.info, issue: ''})}
					),
					...Option.match(transcript, {onNone: () => ({}), onSome: text => ({transcript: text})})
				}))
				yield* tag(note.id, [
					...slides,
					...Array.map(yield* pipe(media.frames(video), optional('No video frames', Array.empty<Uint8Array>)), still)
				])
			})

			const organizeFile = Effect.fnUntraced(function* (note: Note, type: FileType) {
				if (!isVideo(type)) return yield* tag(note.id, [])
				const stored = path.join(files, note.id)
				const stills = yield* pipe(media.fileFrames(stored), optional('No video frames', Array.empty<Uint8Array>))
				yield* Option.match(Array.head(stills), {
					onNone: () => Effect.void,
					onSome: bytes => pipe(storeImage(note.id, still(bytes)), skip('The video preview was not kept'))
				})
				yield* Option.match(yield* pipe(media.fileTranscript(stored), optional('No transcript', Option.none<string>)), {
					onNone: () => Effect.void,
					onSome: text => updateNote(note.id, item => ({...item, transcript: text}))
				})
				yield* tag(note.id, Array.map(Array.drop(stills, 1), still))
			})

			function start(note: Note) {
				return pipe(
					Option.match(Option.fromNullishOr(note.file), {
						onNone: () =>
							Option.match(Option.fromNullishOr(note.url), {
								onNone: () => tag(note.id, []),
								onSome: link => reading.withPermit(organizeLink(note, link))
							}),
						onSome: type => reading.withPermit(organizeFile(note, type))
					}),
					Effect.tapCause(cause =>
						Boolean.match(Cause.hasInterruptsOnly(cause), {
							onFalse: () =>
								pipe(
									updateNote(note.id, item =>
										Boolean.match(item.status === 'organizing', {
											onFalse: () => item,
											onTrue: () => ({...item, issue: 'Tagging stopped before it finished.', status: 'failed' as const})
										})
									),
									skip('A stopped tagging run could not be recorded')
								),
							onTrue: () => Effect.void
						})
					),
					effect => FiberMap.run(runs, note.id, effect),
					Effect.asVoid
				)
			}

			yield* Effect.forEach(
				Array.filter(yield* SubscriptionRef.get(state), note => note.status === 'organizing'),
				start,
				{discard: true}
			)

			const missing = Effect.mapError(() => NotesError.make({message: 'This note no longer exists.'}))

			const receive = Effect.fnUntraced(function* (input: {
				body: Stream.Stream<Uint8Array, unknown>
				id: Note['id']
				type: FileType
			}) {
				const stored = path.join(
					Boolean.match(isVideo(input.type), {onFalse: () => images, onTrue: () => files}),
					input.id
				)
				const partial = `${stored}.${yield* Random.nextIntBetween(0, 1_000_000_000)}.partial`
				yield* pipe(
					input.body,
					Stream.mapError(cause => NotesError.make({cause, message: 'The upload broke off.'})),
					Stream.limitBytes(ByteSize.gibibytes(1), () =>
						Stream.fail(NotesError.make({message: 'The file is larger than 1 GiB.'}))
					),
					Stream.run(fs.sink(partial, {mode: 0o600})),
					Effect.catchTag('PlatformError', cause =>
						Effect.fail(NotesError.make({cause, message: 'The upload could not be written.'}))
					),
					Effect.onError(() => pipe(fs.remove(partial, {force: true}), skip('A broken upload stays on disk')))
				)
				yield* pipe(fs.rename(partial, stored), storageFailed)
				const note = Note.make({
					author: '',
					content: '',
					createdAt: DateTime.toEpochMillis(yield* DateTime.now),
					file: input.type,
					id: input.id,
					...pipe(
						Option.liftPredicate(input.type, Schema.is(ImageType)),
						Option.match({onNone: () => ({title: 'video'}), onSome: image => ({image, title: 'image'})})
					),
					issue: '',
					source: 'Note',
					status: 'organizing',
					summary: '',
					tags: [],
					text: '',
					// oxlint-disable-next-line unicorn/no-null -- The schema stores a missing link as null.
					url: null
				})
				const earlier = yield* transact(current =>
					Option.match(
						Array.findFirst(current, item => item.id === input.id),
						{
							onNone: () => Tuple.make(Option.none<Note>(), Array.prepend(current, note)),
							onSome: item => Tuple.make(Option.some(item), current)
						}
					)
				)
				return yield* Option.match(earlier, {onNone: () => Effect.as(start(note), note), onSome: Effect.succeed})
			})

			return Notes.of({
				capture: Effect.fn('Notes.capture')(function* (input) {
					const text = String.trim(input.text)
					if (String.isEmpty(text)) return yield* NotesError.make({message: 'Paste a link or write a note.'})
					const url = yield* pipe(
						Option.fromUndefinedOr(captureUrl(text)),
						Option.map(link => Effect.orElseSucceed(sources.resolve(link), () => link)),
						Effect.transposeOption
					)
					const createdAt = DateTime.toEpochMillis(yield* DateTime.now)
					const saved = yield* transact<{fresh: boolean; note: Note}>(current =>
						Option.match(
							Array.findFirst(current, note => note.id === input.id || Option.exists(url, link => note.url === link)),
							{
								onNone: () => {
									const note = Note.make({
										author: '',
										content: '',
										createdAt,
										id: input.id,
										issue: '',
										source: Option.match(url, {onNone: () => 'Note' as const, onSome: sourceFor}),
										status: 'organizing',
										summary: '',
										tags: [],
										text,
										title: pipe(
											Option.liftPredicate(commentFor(text), String.isNonEmpty),
											Option.orElse(() => url),
											Option.getOrElse(() => text),
											String.slice(0, 200)
										),
										// oxlint-disable-next-line no-restricted-properties -- The schema stores a missing link as null.
										url: Option.getOrNull(url)
									})
									return Tuple.make({fresh: true, note}, Array.prepend(current, note))
								},
								onSome: note => {
									const merged = withWords(note, text)
									if (note.id === input.id || merged === note) return Tuple.make({fresh: false, note}, current)
									return Tuple.make(
										{fresh: false, note: merged},
										changeNote(current, note.id, () => merged)
									)
								}
							}
						)
					)
					if (saved.fresh) yield* start(saved.note)
					return saved.note
				}),
				captureFile: Effect.fn('Notes.captureFile')(function* (input) {
					return yield* Option.match(yield* findNote(input.id), {onNone: () => receive(input), onSome: Effect.succeed})
				}),
				changes: SubscriptionRef.changes(state),
				events: pipe(
					SubscriptionRef.changes(state),
					Stream.groupedWithin(10_000, '400 millis'),
					Stream.flatMap(group => Stream.fromIterable(Array.takeRight(group, 1))),
					Stream.mapAccum(
						() => Option.none<Note[]>(),
						(previous, current: Note[]) =>
							[
								Option.some(current),
								Option.match(previous, {
									onNone: () => Array.of<NotesEvent>({removed: [], reset: true, upserted: current}),
									onSome: before => {
										const changes = diff(before, current)
										if (Array.isReadonlyArrayEmpty(changes.upserted) && Array.isReadonlyArrayEmpty(changes.removed)) {
											return []
										}
										return Array.of<NotesEvent>({...changes, reset: false})
									}
								})
							] as const
					)
				),
				get: Effect.fn('Notes.get')(function* (input) {
					return yield* pipe(findNote(input.id), Effect.flatMap(Effect.fromOption), missing)
				}),
				image: Effect.fn('Notes.image')(function* (id) {
					const type = yield* pipe(
						findNote(id),
						Effect.map(Option.flatMapNullishOr(note => note.image)),
						Effect.flatMap(Effect.fromOption),
						Effect.mapError(() => NotesError.make({message: 'This note has no preview image.'}))
					)
					return {bytes: yield* pipe(fs.readFile(path.join(images, id)), storageFailed), type}
				}),
				regenerate: Effect.fn('Notes.regenerate')(function* (input) {
					yield* FiberMap.remove(runs, input.id)
					const reset = yield* transact(current =>
						Option.match(
							Array.findFirst(current, note => note.id === input.id),
							{
								onNone: () => Tuple.make(Option.none<Note>(), current),
								onSome: found => {
									const next = {...Struct.omit(found, ['transcript']), issue: '', status: 'organizing' as const}
									return Tuple.make(
										Option.some(next),
										changeNote(current, input.id, () => next)
									)
								}
							}
						)
					)
					yield* pipe(Effect.fromOption(reset), missing, Effect.flatMap(start))
				}),
				remove: Effect.fn('Notes.remove')(function* (input) {
					yield* FiberMap.remove(runs, input.id)
					yield* transact(current =>
						Tuple.make(
							undefined,
							Boolean.match(
								Array.some(current, note => note.id === input.id),
								{onFalse: () => current, onTrue: () => Array.filter(current, note => note.id !== input.id)}
							)
						)
					)
					yield* pipe(fs.remove(path.join(images, input.id), {force: true}), storageFailed)
					yield* pipe(fs.remove(path.join(files, input.id), {force: true}), storageFailed)
				}),
				search: Effect.fn('Notes.search')(function* (input) {
					return Array.map(findNotes(yield* SubscriptionRef.get(state), input.query), note => note.id)
				})
			})
		})
	)
}
