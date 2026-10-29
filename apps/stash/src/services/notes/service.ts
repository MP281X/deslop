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
	Record,
	Ref,
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

import {listEvents} from '@deslop/runtime/server'

import {clock} from '#services/media/lib/utils.ts'
import type {Still} from '#services/media/schema.ts'
import {Media} from '#services/media/service.ts'
import {Sources} from '#services/notes/lib/extraction.ts'
import {Organizer} from '#services/notes/lib/organization.ts'
import {openStore} from '#services/notes/lib/store.ts'
import {
	captureUrl,
	commentFor,
	findNotes,
	hasVideo,
	normalizeTags,
	plainText,
	reuseTags,
	sourceFor,
	tagCounts
} from '#services/notes/lib/utils.ts'
import type {Capture, Extraction, FileType, Image, NotesEvent, Picture, TagDefinition} from '#services/notes/schema.ts'
import {ImageType, Note, NotesError, TagEntry} from '#services/notes/schema.ts'

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

function still(frame: Still) {
	return {bytes: frame.bytes, label: `Video still at [${clock(frame.seconds)}]`, type: 'image/jpeg'} satisfies Picture
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
		readonly list: Effect.Effect<Note[]>
		readonly regenerate: (input: Pick<Note, 'id'>) => Effect.Effect<void, NotesError>
		readonly remove: (input: Pick<Note, 'id'>) => Effect.Effect<void, NotesError>
		readonly search: (input: {query: string}) => Effect.Effect<Note['id'][]>
		readonly tags: Effect.Effect<TagEntry[]>
	}
>()('@deslop/stash/services/notes/service/Notes') {
	static readonly layer = (directory: string) =>
		Layer.effect(
			this,
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem
				const path = yield* Path.Path
				const sources = yield* Sources
				const media = yield* Media
				const organizer = yield* Organizer
				const images = path.join(directory, 'images')
				const files = path.join(directory, 'files')
				const reading = yield* Semaphore.make(2)
				const tagging = yield* Semaphore.make(1)
				const runs = yield* FiberMap.make<Note['id']>()
				const storageFailed = Effect.mapError(cause =>
					NotesError.make({cause, message: 'The notes or files could not be read or written.'})
				)

				yield* pipe(fs.makeDirectory(images, {mode: 0o700, recursive: true}), storageFailed)
				yield* pipe(fs.makeDirectory(files, {mode: 0o700, recursive: true}), storageFailed)
				const store = yield* openStore(directory)
				const state = yield* SubscriptionRef.make(yield* store.load)
				const definitions = yield* Ref.make(
					Record.fromEntries(Array.map(yield* store.definitions, entry => [entry.tag, entry.definition] as const))
				)

				const tagEntries = Effect.gen(function* () {
					const known = yield* Ref.get(definitions)
					return Array.map(tagCounts(yield* SubscriptionRef.get(state)), entry =>
						TagEntry.make({
							...entry,
							...Option.match(Record.get(known, entry.tag), {onNone: () => ({}), onSome: definition => ({definition})})
						})
					)
				})

				const define = Effect.fnUntraced(function* (entries: TagDefinition[]) {
					if (Array.isReadonlyArrayEmpty(entries)) return
					const next = {
						...Record.fromEntries(
							Array.map(
								Array.dedupeWith(entries, (left, right) => left.tag === right.tag),
								entry => [entry.tag, entry.definition] as const
							)
						),
						...(yield* Ref.get(definitions))
					}
					yield* store.saveDefinitions(Array.map(Record.toEntries(next), pair => ({definition: pair[1], tag: pair[0]})))
					yield* Ref.set(definitions, next)
				}, Effect.uninterruptible)

				function transact<A>(change: (current: Note[]) => [A, Note[]]) {
					return Effect.uninterruptible(
						SubscriptionRef.modifyEffect(state, current => {
							const result = change(current)
							if (result[1] === current) return Effect.succeed(result)
							return Effect.as(store.save(result[1]), result)
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

				const tagNote = Effect.fnUntraced(function* (note: Note, stills: Picture[]) {
					const label = Boolean.match(note.file === undefined, {
						onFalse: () => 'The saved photo',
						onTrue: () => 'Preview image'
					})
					const preview = yield* pipe(
						Effect.forEach(
							Option.toArray(Option.fromNullishOr(note.image)),
							type => Effect.map(fs.readFile(path.join(images, note.id)), bytes => ({bytes, label, type})),
							{concurrency: 'unbounded'}
						),
						optional('The preview could not be read', Array.empty<Picture>)
					)
					const pictures = [...preview, ...stills]
					if (
						String.isEmpty(note.content) &&
						!Option.exists(Option.fromUndefinedOr(note.transcript), String.isNonEmpty) &&
						String.isEmpty(commentFor(note.text)) &&
						Array.isReadonlyArrayEmpty(pictures)
					) {
						return yield* updateNote(note.id, item => ({
							...item,
							issue: item.issue ?? 'Nothing to read at this link.',
							status: 'failed'
						}))
					}
					const entries = yield* tagEntries
					const known = yield* Ref.get(definitions)
					const inUse = Array.map(entries, entry => entry.tag)
					const organized = Result.map(
						yield* Effect.result(organizer.organize({images: pictures, note, tags: entries})),
						organization => {
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
					)
					yield* Result.match(organized, {onFailure: () => Effect.void, onSuccess: found => define(found.definitions)})
					yield* updateNote(note.id, item =>
						Result.match(organized, {
							onFailure: error => ({...item, issue: error.message, status: 'failed' as const}),
							// A ready note has no issue, including the one reading left on it.
							onSuccess: found => ({...Struct.omit(item, ['issue']), ...found.organization, status: 'ready' as const})
						})
					)
				})

				// One note at a time, so two notes read together cannot create rival tags for the same topic.
				function tag(id: Note['id'], stills: Picture[]) {
					return Effect.flatMap(
						findNote(id),
						Option.match({onNone: () => Effect.void, onSome: note => tagging.withPermit(tagNote(note, stills))})
					)
				}

				// TikTok's preview image links expire within days, so the server keeps the image; a regenerated note keeps its own.
				const keepImages = Effect.fnUntraced(function* (note: Note, page: Extraction) {
					yield* pipe(
						Effect.forEach(
							Option.toArray(Option.filter(page.image, () => note.image === undefined)),
							image => Effect.flatMap(sources.image(image), bytes => storeImage(note.id, bytes)),
							{concurrency: 'unbounded', discard: true}
						),
						Effect.ignore({log: 'Warn', message: 'The preview image was not kept'})
					)
					const slides = yield* Effect.forEach(
						page.slides ?? [],
						(image, index) =>
							pipe(
								sources.image(image),
								Effect.map(found => Option.some({...found, label: `Image ${index + 2}`})),
								optional('A slide was not read', Option.none<Picture>)
							),
						{concurrency: 4}
					)
					return Array.getSomes(slides)
				})

				// The video's details replace an X post's text only when the post itself could not be read.
				const watch = Effect.fnUntraced(function* (
					note: Note,
					input: {slides: Picture[]; url: string; useInfo: boolean; video: string}
				) {
					const read = yield* pipe(
						media.read(input.video),
						Effect.asSome,
						optional('The video could not be read', Option.none)
					)
					// The transcript and the stills each run yt-dlp, so they run side by side; the note shows its transcript before the stills finish.
					const [, frames] = yield* Effect.all(
						[
							pipe(
								Option.filter(read, () => note.transcript === undefined),
								Option.map(details => pipe(details.transcript, optional('No transcript', Option.none<string>))),
								Effect.transposeOption,
								Effect.map(Option.flatten),
								Effect.flatMap(transcript =>
									updateNote(note.id, item => ({
										...Option.match(
											Option.filter(read, () => sourceFor(input.url) !== 'X' || input.useInfo),
											{
												onNone: () => item,
												onSome: details => ({...Struct.omit(item, ['issue']), content: details.info})
											}
										),
										...Option.match(transcript, {onNone: () => ({}), onSome: text => ({transcript: text})})
									}))
								)
							),
							pipe(media.frames(input.video), optional('No video frames', Array.empty<Still>))
						],
						{concurrency: 2}
					)
					yield* tag(note.id, [...input.slides, ...Array.map(frames, still)])
				})

				const organizeLink = Effect.fnUntraced(function* (note: Note, link: string) {
					const extraction = yield* Effect.result(sources.extract(link))
					yield* updateNote(note.id, item =>
						Result.match(extraction, {
							onFailure: error =>
								Boolean.match(String.isEmpty(item.content), {
									onFalse: () => item,
									onTrue: () => ({...item, issue: error.message})
								}),
							onSuccess: page => ({
								...Struct.omit(item, ['issue']),
								...Option.match(Option.filter(page.author, String.isNonEmpty), {
									onNone: () => ({}),
									onSome: author => ({author})
								}),
								content: page.text,
								title: Boolean.match(String.isNonEmpty(page.title) && item.title === item.url, {
									onFalse: () => item.title,
									onTrue: () => page.title
								})
							})
						})
					)
					const slides = yield* Result.match(extraction, {
						onFailure: () => Effect.succeed(Array.empty<Picture>()),
						onSuccess: page => keepImages(note, page)
					})
					// A video site can refuse the page reader and still answer yt-dlp; a read X post names its video or has none.
					return yield* Option.match(
						Result.match(extraction, {
							onFailure: () => Option.liftPredicate(link, hasVideo),
							onSuccess: page =>
								Option.orElse(Option.fromUndefinedOr(page.video), () =>
									Option.liftPredicate(page.url, address => hasVideo(address) && sourceFor(address) !== 'X')
								)
						}),
						{
							onNone: () => tag(note.id, slides),
							onSome: video =>
								watch(note, {
									slides,
									url: Result.match(extraction, {onFailure: () => link, onSuccess: page => page.url}),
									useInfo: Result.isFailure(extraction),
									video
								})
						}
					)
				})

				const organizeFile = Effect.fnUntraced(function* (note: Note, type: FileType) {
					if (!isVideo(type)) return yield* tag(note.id, [])
					const stored = path.join(files, note.id)
					const stills = yield* pipe(media.fileFrames(stored), optional('No video frames', Array.empty<Still>))
					yield* pipe(
						Option.match(Array.head(stills), {
							onNone: () => Effect.void,
							onSome: frame => storeImage(note.id, {bytes: frame.bytes, type: 'image/jpeg'})
						}),
						Effect.ignore({log: 'Warn', message: 'The video preview was not kept'})
					)
					yield* Option.match(
						yield* pipe(media.fileTranscript(stored), optional('No transcript', Option.none<string>)),
						{onNone: () => Effect.void, onSome: text => updateNote(note.id, item => ({...item, transcript: text}))}
					)
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
												onTrue: () => ({
													...item,
													issue: 'Tagging stopped before it finished.',
													status: 'failed' as const
												})
											})
										),
										Effect.ignore({log: 'Warn', message: 'A stopped tagging run could not be recorded'})
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
					{concurrency: 1, discard: true}
				)

				const missing = Effect.mapError(() =>
					NotesError.make({message: 'No note has this id; find its id with search_notes or list_notes.'})
				)

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
						Effect.onError(() =>
							pipe(
								fs.remove(partial, {force: true}),
								Effect.ignore({log: 'Warn', message: 'A broken upload stays on disk'})
							)
						)
					)
					yield* pipe(fs.rename(partial, stored), storageFailed)
					const note = Note.make({
						content: '',
						createdAt: DateTime.toEpochMillis(yield* DateTime.now),
						file: input.type,
						id: input.id,
						...pipe(
							Option.liftPredicate(input.type, Schema.is(ImageType)),
							Option.match({onNone: () => ({title: 'video'}), onSome: image => ({image, title: 'image'})})
						),
						source: 'Note',
						status: 'organizing',
						summary: '',
						tags: [],
						text: ''
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
								// A link saved in an older form, such as youtu.be, matches its canonical form.
								Array.findFirst(
									current,
									note => note.id === input.id || Option.exists(url, link => captureUrl(note.url ?? '') === link)
								),
								{
									onNone: () => {
										const note = Note.make({
											content: '',
											createdAt,
											id: input.id,
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
											...Option.match(url, {onNone: () => ({}), onSome: link => ({url: link})})
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
						return yield* Option.match(yield* findNote(input.id), {
							onNone: () => receive(input),
							onSome: Effect.succeed
						})
					}),
					changes: SubscriptionRef.changes(state),
					events: pipe(
						SubscriptionRef.changes(state),
						Stream.groupedWithin(10_000, '400 millis'),
						Stream.flatMap(group => Stream.fromIterable(Array.takeRight(group, 1))),
						listEvents
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
					list: SubscriptionRef.get(state),
					regenerate: Effect.fn('Notes.regenerate')(function* (input) {
						yield* FiberMap.remove(runs, input.id)
						const reset = yield* transact(current =>
							Option.match(
								Array.findFirst(current, note => note.id === input.id),
								{
									onNone: () => Tuple.make(Option.none<Note>(), current),
									onSome: found => {
										const next = {...Struct.omit(found, ['issue', 'transcript']), status: 'organizing' as const}
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
					}),
					tags: tagEntries
				})
			})
		)
}

// One shared notes folder.
const notesFolder = pipe(
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem
		const path = yield* Path.Path
		const directory = path.join(yield* Config.String('HOME'), '.deslop', 'stash')
		yield* fs.makeDirectory(directory, {mode: 0o700, recursive: true})
		return directory
	}),
	Effect.mapError(cause => NotesError.make({cause, message: 'The notes folder could not be read.'}))
)

export const layerNotes = Layer.unwrap(Effect.map(notesFolder, directory => Notes.layer(directory)))
