import {
	Array,
	Cause,
	Config,
	Context,
	DateTime,
	Effect,
	FileSystem,
	Layer,
	Option,
	Path,
	Result,
	Schema,
	Semaphore,
	String,
	SubscriptionRef,
	Tuple,
	pipe
} from 'effect'
import type {Stream} from 'effect'

import {Base64} from 'effect/encoding'

import {Sources} from './internal/extraction.ts'
import {Organizer, revision} from './internal/organization.ts'

import {speechOnly} from '#services/media/lib/utils.ts'
import {captureUrl, commentFor, normalizeTags, sourceFor, tagCounts} from '#services/notes/lib/utils.ts'
import type {Capture, FileType, ImageType} from '#services/notes/schema.ts'
import {Extraction, Note, NotesError, NotesState} from '#services/notes/schema.ts'

type NotesFile = typeof NotesFile.Type
const NotesFile = Schema.fromJsonString(NotesState)

// The same post saved again keeps one note and adds only the words it does not have yet; nothing new keeps the note as it is.
function withWords(note: Note, text: string) {
	const known = pipe(note.text, String.toLowerCase, String.split(/\s+/u))
	const added = pipe(
		commentFor(text),
		String.split(' '),
		Array.filter(word => String.isNonEmpty(word) && !Array.contains(known, String.toLowerCase(word)))
	)
	return Array.isReadonlyArrayEmpty(added) ? note : {...note, text: `${note.text}\n${Array.join(added, ' ')}`}
}

export class Notes extends Context.Service<
	Notes,
	{
		readonly capture: (input: Capture) => Effect.Effect<Note, NotesError>
		readonly changes: Stream.Stream<NotesState>
		readonly image: (id: Note['id']) => Effect.Effect<{bytes: Uint8Array; type: ImageType}, NotesError>
		// A photo, screenshot or video from the iPhone becomes a note the AI describes; a resent id returns the saved note.
		readonly captureFile: (input: {
			bytes: Uint8Array
			id: Note['id']
			type: FileType
		}) => Effect.Effect<Note, NotesError>
		readonly remove: (input: Pick<Note, 'id'>) => Effect.Effect<void, NotesError>
	}
>()('@deslop/stash/services/notes/service/Notes') {
	static readonly layer = Layer.effect(
		this,
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const sources = yield* Sources
			const organizer = yield* Organizer
			const scope = yield* Effect.scope
			const home = yield* Config.String('HOME')
			const directory = yield* pipe(
				Config.String('STASH_DATA_DIR'),
				Config.withDefault(path.join(home, '.deslop', 'stash'))
			)
			const budget = yield* pipe(Config.Number('STASH_AI_BUDGET_USD'), Config.withDefault(1))
			const file = path.join(directory, 'notes.json')
			const images = path.join(directory, 'images')
			const files = path.join(directory, 'files')
			const aiCalls = yield* Semaphore.make(1)
			const storageFailed = Effect.mapError(cause =>
				NotesError.make({cause, message: 'The notes file could not be read or written.'})
			)

			const persist = Effect.fnUntraced(function* (next: NotesFile) {
				yield* fs.writeFileString(`${file}.tmp`, yield* Schema.encodeEffect(NotesFile)(next), {mode: 0o600})
				yield* fs.rename(`${file}.tmp`, file)
			}, storageFailed)

			yield* pipe(fs.makeDirectory(directory, {mode: 0o700, recursive: true}), storageFailed)
			const loaded = (yield* pipe(fs.exists(file), storageFailed))
				? yield* pipe(fs.readFileString(file), Effect.flatMap(Schema.decodeEffect(NotesFile)), storageFailed)
				: NotesState.make({aiSpend: {month: '', usd: 0}, notes: []})
			// Tags saved before they became single tokens get hyphens on the next start.
			const migrated = NotesState.make({
				...loaded,
				// Transcripts saved before the speech check lose what Whisper heard in music. A note an older organizer tagged is
				// read and tagged again with the current one.
				notes: Array.map(loaded.notes, note => {
					const {transcript, ...rest} = note
					return {
						...rest,
						...(note.status === 'ready' && (note.revision ?? 0) < revision ? {status: 'organizing' as const} : {}),
						tags: normalizeTags(note.tags),
						...Option.match(Option.flatMap(Option.fromNullishOr(transcript), speechOnly), {
							onNone: () => ({}),
							onSome: text => ({transcript: text})
						})
					}
				})
			})
			yield* persist(migrated)
			const state = yield* SubscriptionRef.make(migrated)

			// Applies one change to memory and disk together: the file holds every change anyone has seen.
			function transact<A>(change: (current: NotesState) => [A, NotesState]) {
				return Effect.uninterruptible(
					SubscriptionRef.modifyEffect(state, current => {
						const result = change(current)
						if (result[1] === current) return Effect.succeed(result)
						return Effect.as(persist(result[1]), result)
					})
				)
			}

			function updateNote(id: Note['id'], change: (note: Note) => Note) {
				return transact(current =>
					Tuple.make(undefined, {
						...current,
						notes: Array.map(current.notes, note => (note.id === id ? change(note) : note))
					})
				)
			}

			const tag = Effect.fnUntraced(function* (note: Note, current: NotesState, frames: string[]) {
				const month = String.slice(0, 7)(DateTime.formatIsoDateUtc(yield* DateTime.now))
				const spent = current.aiSpend.month === month ? current.aiSpend.usd : 0
				// A bare link whose page could not be read gives the AI nothing to organize, so it costs no call.
				if (
					String.isEmpty(note.content) &&
					String.isEmpty(note.transcript ?? '') &&
					String.isEmpty(commentFor(note.text)) &&
					Array.isReadonlyArrayEmpty(frames)
				) {
					yield* updateNote(note.id, item => ({...item, status: 'saved'}))
					return
				}
				if (!organizer.enabled || spent >= budget) {
					const reason = organizer.enabled ? "this month's AI budget is used up" : 'the server has no OpenRouter key'
					yield* updateNote(note.id, item => ({...item, issue: `Not tagged: ${reason}.`, status: 'saved'}))
					return
				}
				const outcome = yield* Effect.result(
					organizer.organize({frames, note, tags: Array.map(tagCounts(current.notes), entry => entry.tag)})
				)
				yield* transact(latest =>
					Tuple.make(undefined, {
						aiSpend: {
							month,
							usd:
								(latest.aiSpend.month === month ? latest.aiSpend.usd : 0) +
								Result.match(outcome, {onFailure: () => 0, onSuccess: answer => answer.cost})
						},
						notes: Array.map(latest.notes, item => {
							if (item.id !== note.id) return item
							return Result.match(
								Result.flatMap(outcome, answer => answer.organization),
								{
									onFailure: error => ({...item, issue: error.message, status: 'saved' as const}),
									onSuccess: organization => ({...item, ...organization, revision, status: 'ready' as const})
								}
							)
						})
					})
				)
			})

			// The preview is kept on disk, because TikTok's image links expire within days.
			const keepImage = Effect.fnUntraced(function* (id: Note['id'], link: string) {
				yield* storeImage(id, yield* sources.image(link))
			})

			const storeImage = Effect.fnUntraced(function* (id: Note['id'], image: {bytes: Uint8Array; type: ImageType}) {
				// Written under the same lock as removal, so a note deleted during the download leaves no file behind.
				yield* Effect.uninterruptible(
					SubscriptionRef.modifyEffect(state, current =>
						Effect.gen(function* () {
							if (!Array.some(current.notes, note => note.id === id)) return Tuple.make(undefined, current)
							yield* pipe(fs.makeDirectory(images, {mode: 0o700, recursive: true}), storageFailed)
							yield* pipe(fs.writeFile(path.join(images, id), image.bytes, {mode: 0o600}), storageFailed)
							const next = {
								...current,
								notes: Array.map(current.notes, note => (note.id === id ? {...note, image: image.type} : note))
							}
							yield* persist(next)
							return Tuple.make(undefined, next)
						})
					)
				)
			})

			// The kept preview as an image the AI can see; a missing file only costs that picture.
			const previewOf = Effect.fnUntraced(
				function* (id: Note['id'], type: ImageType) {
					return [`data:${type};base64,${Base64.encode(yield* fs.readFile(path.join(images, id)))}`]
				},
				Effect.catch(error => Effect.as(Effect.logWarning('The preview could not be read', error), []))
			)

			const organize = Effect.fnUntraced(function* (id: Note['id'], url: Note['url']) {
				const empty = Extraction.make({author: '', image: Option.none(), text: '', title: '', url: ''})
				const extraction = yield* Option.match(Option.fromNullishOr(url), {
					onNone: () => Effect.succeed(Result.succeed(empty)),
					onSome: link => Effect.result(sources.extract(link))
				})
				const extracted = Result.getOrElse(extraction, () => empty)
				const resolved = Option.filter(Option.fromNullishOr(url), () => Result.isSuccess(extraction))
				// Applied to the latest notes, so words merged in while the link loaded stay. Another share of a saved post, under a
				// new short link, joins that note instead and needs no preview or AI call of its own.
				const joined = yield* transact(current =>
					Option.match(
						Option.all({
							note: Array.findFirst(current.notes, item => item.id === id),
							twin: Option.flatMap(resolved, () =>
								Array.findFirst(current.notes, item => item.id !== id && item.url === extracted.url)
							)
						}),
						{
							onNone: () =>
								Tuple.make(false, {
									...current,
									notes: Array.map(current.notes, item =>
										item.id === id
											? {
													...item,
													// A run resumed after a restart keeps what an earlier read fetched when the link fails now.
													...Result.match(extraction, {
														onFailure: error => ({issue: String.isEmpty(item.content) ? error.message : item.issue}),
														onSuccess: page => ({author: page.author, content: page.text, issue: ''})
													}),
													// A bare link has no words of its own, so the page title names it until the AI does.
													title:
														String.isNonEmpty(extracted.title) && item.title === item.url
															? extracted.title
															: item.title,
													url: Option.match(resolved, {onNone: () => item.url, onSome: () => extracted.url})
												}
											: item
									)
								}),
							onSome: pair =>
								Tuple.make(true, {
									...current,
									notes: Array.flatMap(current.notes, item => {
										if (item.id === id) return []
										return item.id === pair.twin.id ? [withWords(pair.twin, pair.note.text)] : [item]
									})
								})
						}
					)
				)
				if (joined) return
				// A missing preview only costs the picture, so the note goes on without it.
				yield* Option.match(extracted.image, {
					onNone: () => Effect.void,
					onSome: link =>
						Effect.catch(keepImage(id, link), error => Effect.logWarning('The preview image was not kept', error))
				})
				// A video's details (date, length, description, chapters) replace the short caption of a TikTok or YouTube link;
				// an X post's own text stays, because its video file has no details. What the video says feeds the tags and search;
				// without captions, local Whisper can take minutes. A note deleted meanwhile needs neither, and one that kept its
				// transcript before needs no new one.
				const before = Array.findFirst((yield* SubscriptionRef.get(state)).notes, item => item.id === id)
				if (Option.isSome(resolved) && Option.isSome(before)) {
					const video = yield* sources.video(
						extracted.video ?? extracted.url,
						Option.getOrThrow(before).transcript === undefined
					)
					yield* updateNote(id, item => ({
						...item,
						...Option.match(
							Option.filter(video.info, () => extracted.video === undefined),
							{onNone: () => ({}), onSome: info => ({content: info})}
						),
						...Option.match(video.transcript, {onNone: () => ({}), onSome: transcript => ({transcript})})
					}))
				}
				// The kept preview and stills of a video let the AI see what the link shows; a note deleted meanwhile needs none.
				const kept = Array.findFirst((yield* SubscriptionRef.get(state)).notes, item => item.id === id)
				const preview = yield* Option.match(
					Option.flatMapNullishOr(kept, item => item.image),
					{onNone: () => Effect.succeed([]), onSome: type => previewOf(id, type)}
				)
				const stills = Option.isSome(kept)
					? yield* Option.match(resolved, {
							onNone: () => Effect.succeed([]),
							onSome: () => sources.frames(extracted.video ?? extracted.url)
						})
					: []
				const frames = [...preview, ...stills]
				// One AI call at a time, so two captures cannot both pass the budget check before either records its cost.
				yield* aiCalls.withPermit(
					Effect.gen(function* () {
						const current = yield* SubscriptionRef.get(state)
						yield* Option.match(
							Array.findFirst(current.notes, item => item.id === id),
							{onNone: () => Effect.void, onSome: note => tag(note, current, frames)}
						)
					})
				)
			})

			// A file note has no link to read: a photo or screenshot is its own preview, and a video gives its first still as the
			// preview, stills for the AI and its speech as the transcript.
			const organizeFile = Effect.fnUntraced(function* (id: Note['id'], type: FileType) {
				const stored = path.join(files, id)
				const stills = type === 'video/mp4' || type === 'video/quicktime' ? yield* sources.fileFrames(stored) : []
				yield* Option.match(Array.head(stills), {
					onNone: () => Effect.void,
					onSome: bytes =>
						Effect.catch(storeImage(id, {bytes, type: 'image/jpeg'}), error =>
							Effect.logWarning('The video preview was not kept', error)
						)
				})
				if (Array.isReadonlyArrayNonEmpty(stills)) {
					yield* Option.match(yield* sources.fileTranscript(stored), {
						onNone: () => Effect.void,
						onSome: transcript => updateNote(id, item => ({...item, transcript}))
					})
				}
				const preview = yield* Option.match(
					Option.flatMapNullishOr(
						Array.findFirst((yield* SubscriptionRef.get(state)).notes, item => item.id === id),
						item => item.image
					),
					{onNone: () => Effect.succeed([]), onSome: image => previewOf(id, image)}
				)
				const frames = [
					...preview,
					...Array.map(Array.drop(stills, 1), bytes => `data:image/jpeg;base64,${Base64.encode(bytes)}`)
				]
				yield* aiCalls.withPermit(
					Effect.gen(function* () {
						const current = yield* SubscriptionRef.get(state)
						yield* Option.match(
							Array.findFirst(current.notes, item => item.id === id),
							{onNone: () => Effect.void, onSome: note => tag(note, current, frames)}
						)
					})
				)
			})

			// Tagging runs beside the request. A shutdown leaves the note organizing, so the next start tags it again; any other
			// stop keeps the note as it is and says why.
			function start(note: Note) {
				return pipe(
					Option.match(Option.fromNullishOr(note.file), {
						onNone: () => organize(note.id, note.url),
						onSome: type => organizeFile(note.id, type)
					}),
					Effect.tapCause(cause =>
						Cause.hasInterruptsOnly(cause)
							? Effect.void
							: pipe(
									updateNote(note.id, item =>
										item.status === 'organizing'
											? {...item, issue: 'Tagging stopped before it finished.', status: 'saved'}
											: item
									),
									Effect.catch(error => Effect.logError('A stopped tagging run could not be recorded', error))
								)
					),
					Effect.forkIn(scope),
					Effect.asVoid
				)
			}

			yield* Effect.forEach(
				Array.filter(migrated.notes, note => note.status === 'organizing'),
				start,
				{discard: true}
			)

			return Notes.of({
				capture: Effect.fn('Notes.capture')(function* (input: Capture) {
					const text = String.trim(input.text)
					if (String.isEmpty(text)) return yield* NotesError.make({message: 'Paste a link or write a note.'})
					const url = captureUrl(text)
					const createdAt = DateTime.toEpochMillis(yield* DateTime.now)
					const saved = yield* transact<{fresh: boolean; note: Note}>(current =>
						Option.match(
							Array.findFirst(current.notes, note => note.id === input.id || (url !== null && note.url === url)),
							{
								onNone: () => {
									const note = Note.make({
										author: '',
										content: '',
										createdAt,
										id: input.id,
										issue: '',
										source: sourceFor(url),
										status: 'organizing',
										summary: '',
										tags: [],
										text,
										title: String.slice(
											0,
											200
										)(
											pipe(
												Option.liftPredicate(commentFor(text), String.isNonEmpty),
												Option.getOrElse(() => url ?? text)
											)
										),
										url
									})
									return Tuple.make({fresh: true, note}, {...current, notes: Array.prepend(current.notes, note)})
								},
								// The same link saved again keeps one note and adds only its new words, without another AI call.
								onSome: note => {
									const merged = withWords(note, text)
									if (note.id === input.id || merged === note) return Tuple.make({fresh: false, note}, current)
									return Tuple.make(
										{fresh: false, note: merged},
										{...current, notes: Array.map(current.notes, item => (item.id === note.id ? merged : item))}
									)
								}
							}
						)
					)
					if (saved.fresh) yield* start(saved.note)
					return saved.note
				}),
				captureFile: Effect.fn('Notes.captureFile')(function* (input: {
					bytes: Uint8Array
					id: Note['id']
					type: FileType
				}) {
					const known = Array.findFirst((yield* SubscriptionRef.get(state)).notes, note => note.id === input.id)
					if (Option.isSome(known)) return Option.getOrThrow(known)
					const video = input.type === 'video/mp4' || input.type === 'video/quicktime'
					// The file is on disk before the note, so a note never names a file that is not there.
					yield* pipe(fs.makeDirectory(files, {mode: 0o700, recursive: true}), storageFailed)
					yield* pipe(fs.writeFile(path.join(files, input.id), input.bytes, {mode: 0o600}), storageFailed)
					if (!video) {
						yield* pipe(fs.makeDirectory(images, {mode: 0o700, recursive: true}), storageFailed)
						yield* pipe(fs.writeFile(path.join(images, input.id), input.bytes, {mode: 0o600}), storageFailed)
					}
					const note = Note.make({
						author: '',
						content: '',
						createdAt: DateTime.toEpochMillis(yield* DateTime.now),
						file: input.type,
						id: input.id,
						...(video ? {} : {image: input.type === 'image/png' ? 'image/png' : 'image/jpeg'}),
						issue: '',
						source: 'Note',
						status: 'organizing',
						summary: '',
						tags: [],
						text: '',
						title: video ? 'video' : 'image',
						// A file has no link; the stored field keeps the schema's null for that.
						url: Option.getOrNull(Option.none())
					})
					// The share extension and the app can send the same file at once, so the id is checked again in the change.
					const earlier = yield* transact(current =>
						Option.match(
							Array.findFirst(current.notes, item => item.id === input.id),
							{
								onNone: () => Tuple.make(Option.none<Note>(), {...current, notes: Array.prepend(current.notes, note)}),
								onSome: item => Tuple.make(Option.some(item), current)
							}
						)
					)
					if (Option.isSome(earlier)) return Option.getOrThrow(earlier)
					yield* start(note)
					return note
				}),
				changes: SubscriptionRef.changes(state),
				image: Effect.fn('Notes.image')(function* (id: Note['id']) {
					const type = yield* pipe(
						Array.findFirst((yield* SubscriptionRef.get(state)).notes, note => note.id === id),
						Option.flatMap(note => Option.fromNullishOr(note.image)),
						Effect.fromOption,
						Effect.mapError(() => NotesError.make({message: 'This note has no preview image.'}))
					)
					return {bytes: yield* pipe(fs.readFile(path.join(images, id)), storageFailed), type}
				}),
				remove: Effect.fn('Notes.remove')(function* (input: Pick<Note, 'id'>) {
					yield* transact(current =>
						Tuple.make(
							undefined,
							Array.some(current.notes, note => note.id === input.id)
								? {...current, notes: Array.filter(current.notes, note => note.id !== input.id)}
								: current
						)
					)
					yield* pipe(fs.remove(path.join(images, input.id), {force: true}), storageFailed)
					yield* pipe(fs.remove(path.join(files, input.id), {force: true}), storageFailed)
				})
			})
		})
	)
}
