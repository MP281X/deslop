import {
	Array,
	Boolean,
	Cause,
	Effect,
	Exit,
	Fiber,
	FileSystem,
	Function,
	HashSet,
	Layer,
	Option,
	Path,
	Result,
	Schema,
	Stream,
	String,
	Struct,
	pipe
} from 'effect'

import {Reactivity} from 'effect/reactivity'
import {SqlClient, SqlSchema} from 'effect/sql'

import type {UserId} from '@deslop/runtime/shared/auth'

import type {MediaError, Still} from '#media/contract.ts'
import {clock} from '#media/media-text.ts'
import {Media} from '#media/server.ts'
import {commentOf, hasVideo, isVideo} from '#notes/content.ts'
import {Note, NoteChange} from '#notes/contract.ts'
import type {Extraction, FileType, NoteId, Picture} from '#notes/contract.ts'
import {Runs} from '#notes/runs.ts'
import {Notes, asNotesError} from '#notes/server.ts'
import {sourceOf} from '#notes/shared.ts'
import {Sources} from '#sources/server.ts'
import {Organizer} from '#tags/server.ts'
import {Transcripts} from '#transcripts/server.ts'

function still(frame: Still) {
	return {bytes: frame.bytes, label: `Video still at [${clock(frame.seconds)}]`, type: 'image/jpeg'} satisfies Picture
}

// Notes saved as organizing are read, tagged and settled by a few workers here; a request only saves the note and signals them.
export const layerOrganizing = Layer.effectDiscard(
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const fs = yield* FileSystem.FileSystem
		const path = yield* Path.Path
		const sources = yield* Sources
		const media = yield* Media
		const transcripts = yield* Transcripts
		const organizer = yield* Organizer
		const notes = yield* Notes
		const reactivity = yield* Reactivity.Reactivity
		const runs = yield* Runs

		const tagNote = Effect.fnUntraced(function* (userId: UserId, note: Note, stills: Picture[]) {
			const label = Boolean.match(Option.isNone(note.file), {
				onFalse: Function.constant('The saved photo'),
				onTrue: Function.constant('Preview image')
			})
			const pictures = [
				...(yield* pipe(
					Option.toArray(note.image),
					Effect.forEach(
						type =>
							Effect.map(fs.readFile(path.join(notes.directories.images, note.id)), bytes => ({bytes, label, type})),
						{concurrency: 'unbounded'}
					),
					Effect.catch(error =>
						Effect.as(Effect.logWarning('The saved preview could not be read', error), Array.empty<Picture>())
					)
				)),
				...stills
			]
			if (
				String.isEmpty(note.content) &&
				!Option.exists(note.transcript, String.isNonEmpty) &&
				String.isEmpty(commentOf(note.text)) &&
				Array.isReadonlyArrayEmpty(pictures)
			) {
				return yield* notes.persist(note.id, NoteChange.cases.empty.make({}))
			}
			yield* Result.match(
				yield* Effect.result(
					organizer.organize(userId, {images: pictures, note, tags: yield* asNotesError(notes.tagEntries())})
				),
				{
					// The organizer's message is already safe to show, and some, such as a missing key, say what to do.
					onFailure: error => notes.persist(note.id, NoteChange.cases.fail.make({issue: error.message})),
					onSuccess: organization => notes.organized(note.id, organization, note.text)
				}
			)
		})

		// Haiku calls may overlap; tag definitions and each note's organization still commit atomically.
		function tag(userId: UserId, id: NoteId, stills: Picture[]) {
			return pipe(
				notes.findNote(id),
				Effect.flatMap(Option.match({onNone: () => Effect.void, onSome: note => tagNote(userId, note, stills)})),
				Effect.withSpan('Notes.tag', {attributes: {'note.id': id}})
			)
		}

		// TikTok's preview image links expire within days, so the server keeps the image; a regenerated note keeps its own.
		const keepPreview = Effect.fnUntraced(function* (note: Note, preview: Extraction['image']) {
			yield* Effect.forEach(
				Option.toArray(Option.filter(preview, () => Option.isNone(note.image))),
				image => Effect.flatMap(sources.image(image), bytes => notes.storeImage(note.id, bytes)),
				{concurrency: 'unbounded', discard: true}
			)
		})

		function readSlides(slides: Extraction['slides']) {
			return pipe(
				slides,
				Option.toArray,
				Array.flatten,
				Effect.forEach(
					(image, index) =>
						pipe(
							sources.image(image),
							Effect.map(found => ({...found, label: `Image ${index + 2}`})),
							Effect.tapError(error => Effect.logWarning('A slide was not read', error)),
							Effect.option
						),
					{concurrency: 4}
				),
				Effect.map(Array.getSomes)
			)
		}

		// A media failure is logged; one Gateway refused, whose message says what to do, or one that spent the note's budget also leaves its message on the note, so a note that ends with nothing to read says why.
		function explained(id: NoteId, error: MediaError) {
			if (error.reason === undefined) return Effect.void
			return notes.persist(id, NoteChange.cases.issue.make({issue: error.message}))
		}

		function untranscribed(id: NoteId) {
			return (error: MediaError) =>
				pipe(
					Effect.logWarning('No transcript', error),
					Effect.andThen(explained(id, error)),
					Effect.as(Option.none<string>())
				)
		}

		function framesOf(id: NoteId, frames: Effect.Effect<Still[], MediaError>) {
			return Effect.catch(frames, error =>
				pipe(
					Effect.logWarning('No video frames', error),
					Effect.andThen(explained(id, error)),
					Effect.as(Array.empty<Still>())
				)
			)
		}

		// Read video details and frames, then tag the note; details replace content for non-X links, and for X only when useInfo says the post itself could not be read.
		const watch = Effect.fnUntraced(function* (
			userId: UserId,
			note: Note,
			input: {slides: Picture[]; url: string; useInfo: boolean; video: string}
		) {
			// The transcript and the frames each run yt-dlp, so they run concurrently under the note's one media budget; the transcript is stored as soon as it arrives, and tagging waits for both.
			const budget = yield* media.budget
			const [, frames] = yield* Effect.all(
				[
					pipe(
						transcripts.read(budget, userId, input.url, Option.some(input.video)),
						Effect.tapError(error =>
							Effect.andThen(Effect.logWarning('The video could not be read', error), explained(note.id, error))
						),
						Effect.option,
						Effect.flatMap(read =>
							pipe(
								Option.filter(read, () => Option.isNone(note.transcript)),
								Option.map(details =>
									Effect.catchTag(
										details.transcript((elapsed, total) =>
											Effect.andThen(
												runs.track(note.id, {elapsed, title: String.slice(0, 120)(details.title), total}),
												reactivity.invalidate(['stashProgress'])
											)
										),
										'MediaError',
										untranscribed(note.id)
									)
								),
								Effect.transposeOption,
								Effect.map(Option.flatten),
								Effect.flatMap(transcript =>
									notes.persist(
										note.id,
										NoteChange.cases.video.make({
											content: pipe(
												read,
												Option.filter(() => sourceOf(input.url) !== 'X' || input.useInfo),
												Option.map(details => details.info)
											),
											transcript
										})
									)
								)
							)
						)
					),
					framesOf(note.id, media.frames(budget, input.video))
				],
				{concurrency: 2}
			)
			yield* tag(userId, note.id, [...input.slides, ...Array.map(frames, still)])
		}, Effect.scoped)

		// Sources.resolve only canonicalizes an already usable shared URL; organizeLink performs content extraction separately, so a logged resolution failure may keep the shared URL.
		const resolveLink = Effect.fnUntraced(function* (id: NoteId, link: string) {
			const url = yield* Effect.catch(sources.resolve(link), error =>
				Effect.as(Effect.logWarning('The short link was not resolved', error), link)
			)
			return yield* notes.resolved(id, url)
		})

		// The note as resolved: its canonical link, or the shared one when resolution failed.
		const organizeLink = Effect.fnUntraced(function* (userId: UserId, note: Note, original: string) {
			const link = Option.getOrElse(note.url, () => original)
			const extraction = yield* pipe(
				sources.extract(link),
				Effect.tapError(error => Effect.logWarning('The saved link could not be extracted', error)),
				Effect.result
			)
			yield* notes.change(note.id, NoteChange.cases.extract.make({extraction}))
			const slides = yield* Result.match(extraction, {
				onFailure: () => Effect.succeed(Array.empty<Picture>()),
				onSuccess: Effect.fnUntraced(function* (page) {
					yield* Effect.ignore(keepPreview(note, page.image), {log: 'Warn', message: 'The preview image was not kept'})
					return yield* readSlides(page.slides)
				})
			})
			// A video site can refuse the page reader and still answer yt-dlp; a read X post names its video or has none.
			return yield* pipe(
				extraction,
				Result.match({
					onFailure: () => Option.liftPredicate(link, hasVideo),
					onSuccess: page =>
						Option.orElse(page.video, () =>
							Option.liftPredicate(page.url, address => hasVideo(address) && sourceOf(address) !== 'X')
						)
				}),
				Option.match({
					onNone: () => tag(userId, note.id, slides),
					onSome: video =>
						watch(userId, note, {
							slides,
							url: Result.match(extraction, {onFailure: () => link, onSuccess: page => page.url}),
							useInfo: Result.isFailure(extraction),
							video
						})
				})
			)
		})

		const organizeFile = Effect.fnUntraced(function* (userId: UserId, note: Note, type: FileType) {
			if (!isVideo(type)) return yield* tag(userId, note.id, [])
			const stored = path.join(notes.directories.files, note.id)
			const budget = yield* media.budget
			const [stills] = yield* Effect.all(
				[
					Effect.gen(function* () {
						const frames = yield* framesOf(note.id, media.fileFrames(budget, stored))
						yield* pipe(
							Array.head(frames),
							Option.match({
								onNone: () => Effect.void,
								onSome: frame => notes.storeImage(note.id, {bytes: frame.bytes, type: 'image/jpeg'})
							}),
							Effect.ignore({log: 'Warn', message: 'The video preview was not kept'})
						)
						return frames
					}),
					// A transcript an earlier run committed is reused, so a restart does not pay for it again.
					Option.match(note.transcript, {
						onNone: () =>
							pipe(
								transcripts.fileTranscript(budget, userId, stored),
								Effect.catchTag('MediaError', untranscribed(note.id)),
								Effect.flatMap(
									Option.match({
										onNone: () => Effect.void,
										onSome: text =>
											notes.persist(
												note.id,
												NoteChange.cases.video.make({content: Option.none(), transcript: Option.some(text)})
											)
									})
								)
							),
						onSome: () => Effect.void
					})
				],
				{concurrency: 2}
			)
			yield* tag(userId, note.id, pipe(stills, Array.drop(1), Array.map(still)))
		}, Effect.scoped)

		// A worker reads the note again when it starts, so a note deleted, finished or asked again while it waited runs as it is now.
		function organize(id: NoteId) {
			return Effect.flatMap(runs.takeRequest(id), request =>
				pipe(
					notes.findNote(id),
					Effect.flatMap(
						Option.match({
							onNone: () => Effect.void,
							onSome: note =>
								Boolean.match(note.status === 'organizing', {
									onFalse: () => Effect.void,
									onTrue: () =>
										Option.match(note.file, {
											onNone: () =>
												Option.match(note.url, {
													onNone: () => tag(note.requester, note.id, []),
													// Skip organization when resolution finds no remaining note, including after merging a duplicate.
													onSome: link =>
														Effect.flatMap(
															resolveLink(note.id, link),
															Option.match({
																onNone: () => Effect.void,
																onSome: canonical => organizeLink(note.requester, canonical, link)
															})
														)
												}),
											onSome: type => organizeFile(note.requester, note, type)
										})
								})
						})
					),
					// A run that ends without settling its note, failed or not, marks it failed, so while the server runs no claim asks the provider again: one run asks until it has one answer, at most twice when the provider answers with an error. When even that write fails for good, the note is remembered as unrecorded and left alone. A restart cuts a run short and the next start asks again, so a charge can repeat. Only a stop or removal interrupts the write.
					Effect.onExit(exit =>
						Boolean.match(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause), {
							onFalse: () =>
								pipe(
									notes.persist(id, NoteChange.cases.stop.make({})),
									Effect.tapError(() => runs.exclusive(runs.unrecord(id))),
									Effect.interruptible,
									Effect.ignore({log: 'Warn', message: 'A stopped tagging run could not be recorded'})
								),
							onTrue: () => Effect.void
						})
					),
					// A finished or cancelled capture must not keep its request's trace open; the pipeline links back to it instead.
					Effect.ensuring(runs.untrack(id)),
					Effect.withSpan('Notes.organize', {
						attributes: {'note.id': id},
						links: Option.toArray(Option.map(request, span => ({attributes: {'link.type': 'follows-from'}, span}))),
						root: true
					})
				)
			)
		}

		// The files each kept note owns: a preview or photo in images, an uploaded video in files.
		const listOwners = SqlSchema.findAll({
			Request: Schema.Void,
			Result: Schema.Struct(Struct.pick(Note.fields, ['file', 'id', 'image'])),
			execute: () => sql`SELECT id, file, image FROM notes WHERE file IS NOT NULL OR image IS NOT NULL`
		})
		// A crash can leave an upload half received, a published file whose row never committed, a preview without its row's mark, or a deleted note's files; at start only files a kept note owns stay.
		const owners = yield* asNotesError(listOwners())
		const sweep = Effect.fnUntraced(function* (folder: string, keep: (name: string) => boolean) {
			yield* pipe(
				yield* fs.readDirectory(folder),
				Array.filter(name => !keep(name)),
				Effect.forEach(name => fs.remove(path.join(folder, name), {force: true, recursive: true}), {
					concurrency: 'unbounded',
					discard: true
				})
			)
		})
		const previews = HashSet.fromIterable(
			pipe(
				owners,
				Array.filter(owner => Option.isSome(owner.image)),
				Array.map(owner => owner.id)
			)
		)
		const videos = HashSet.fromIterable(
			pipe(
				owners,
				Array.filter(owner => Option.exists(owner.file, isVideo)),
				Array.map(owner => owner.id)
			)
		)
		yield* asNotesError(
			Effect.all(
				[
					sweep(notes.directories.images, name => HashSet.has(previews, name)),
					sweep(notes.directories.files, name => HashSet.has(videos, name)),
					sweep(notes.directories.root, name => !String.startsWith('upload-')(name))
				],
				{concurrency: 'unbounded'}
			)
		)

		// A note still organizing is pending work, so a restart or a request that ended early leaves it to be claimed again.
		const listOrganizing = SqlSchema.findAll({
			Request: Schema.Void,
			Result: Schema.Struct(Struct.pick(Note.fields, ['createdAt', 'id'])),
			execute: () => sql`SELECT createdAt, id FROM notes WHERE status = ${'organizing' satisfies Note['status']}`
		})
		const claim = runs.claim(asNotesError(listOrganizing()))
		// A commit that leaves a note organizing signals at once; the scan at start and each minute also claims a note whose signal was lost.
		yield* pipe(
			Stream.merge(Stream.tick('1 minute'), runs.signals),
			Stream.runForEach(() =>
				Effect.catch(claim, error => Effect.logWarning('The notes waiting to be organized could not be read', error))
			),
			Effect.forkScoped
		)

		const work = Effect.andThen(
			runs.waiting,
			Effect.flatMap(runs.start(organize), run =>
				Effect.forEach(Option.toArray(run), Fiber.await, {concurrency: 1, discard: true})
			)
		)
		yield* Effect.forEach(Array.range(1, 8), () => pipe(work, Effect.forever, Effect.forkScoped), {
			concurrency: 1,
			discard: true
		})
	})
)
