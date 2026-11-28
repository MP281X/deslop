import {
	Array,
	Boolean,
	ByteSize,
	Context,
	Duration,
	Effect,
	FileSystem,
	Function,
	Layer,
	Option,
	Path,
	Redacted,
	Result,
	Schema,
	Semaphore,
	String,
	pipe
} from 'effect'

import {Base64} from 'effect/encoding'
import {HttpClient, HttpClientRequest, HttpClientResponse} from 'effect/http'

import {AiGateway} from '@deslop/runtime/server/ai'
import type {UserId} from '@deslop/runtime/shared/auth'

import {CreatorCaptions, MediaError, Refusal, Transcript, TranscriptionResponse} from '#media/contract.ts'
import type {MediaBudget, MediaMetadata} from '#media/contract.ts'
import {
	captionTracks,
	captionTranscript,
	clock,
	isBlocked,
	LOCAL_ONLY,
	mediaMarkdown,
	speechOnly
} from '#media/media-text.ts'
import {Media, withinDeadline} from '#media/server.ts'

const MAX_TRANSCRIPTION_DURATION = Duration.hours(2)

type TranscriptionProgress = (elapsed: number, total: number) => Effect.Effect<void>

const transcriptOf = Effect.fnUntraced(function* (
	response: TranscriptionResponse,
	duration: Duration.Duration,
	index: number
) {
	const candidate = Option.flatMap(response.candidates, Array.head)
	const answer = yield* pipe(
		candidate,
		Option.filter(value => Option.contains(value.finishReason, 'STOP')),
		Option.flatMap(value => value.content),
		Option.map(value =>
			pipe(
				value.parts,
				Array.filter(part => part.thought !== true),
				Array.map(part => part.text),
				Array.join('')
			)
		),
		Option.flatMap(Schema.decodeOption(Schema.fromJsonString(Transcript))),
		Option.match({
			onNone: () =>
				MediaError.make({
					message: `Audio chunk has no usable answer (${pipe(
						candidate,
						Option.flatMap(value => value.finishReason),
						Option.getOrElse(Function.constant('missing or blocked'))
					)})`
				}),
			onSome: Effect.succeed
		})
	)
	// A bad model response must not hide missing speech as silence.
	if (answer.kind === 'silence') return answer
	// An out-of-range timestamp could put speech in the wrong part of the assembled transcript.
	const segments = Array.filter(
		answer.segments,
		segment =>
			Duration.isGreaterThanOrEqualTo(segment.start, Duration.zero) && Duration.isLessThan(segment.start, duration)
	)
	if (segments.length !== answer.segments.length) {
		yield* Effect.logWarning('Audio chunk returned timestamps outside its duration', {
			chunk: index + 1,
			dropped: answer.segments.length - segments.length
		})
	}
	if (Array.isArrayEmpty(segments)) {
		return yield* MediaError.make({message: 'Audio chunk returned no speech segments without reporting silence'})
	}
	if (
		Option.isNone(
			speechOnly(
				pipe(
					segments,
					Array.map(segment => `[${clock(segment.start)}] ${segment.text}\n`),
					Array.join('')
				)
			)
		)
	) {
		return yield* MediaError.make({message: 'Audio chunk did not contain usable speech'})
	}
	return {kind: 'speech' as const, segments}
})

// Gateway's refusal carries its instruction, such as to save a key, which the person needs to see.
function refused(response: HttpClientResponse.HttpClientResponse) {
	return pipe(
		response.text,
		Effect.flatMap(Schema.decodeEffect(Refusal)),
		Effect.map(refusal => refusal.error.message),
		Effect.result,
		Effect.flatMap(instruction =>
			Effect.fail(
				MediaError.make({
					cause: instruction,
					message: Result.getOrElse(instruction, Function.constant('Gateway refused the transcription.')),
					reason: 'Refused'
				})
			)
		)
	)
}

// What a video says: its creator's captions, else the audio the AI listens to, within a note's media budget.
export class Transcripts extends Context.Service<Transcripts>()('@deslop/stash/transcripts/server/Transcripts', {
	make: Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem
		const path = yield* Path.Path
		const tools = yield* Media
		const gateway = yield* AiGateway
		const http = yield* HttpClient.HttpClient
		const transcription = yield* Semaphore.make(1)
		const listen = Effect.fnUntraced(function* (
			budget: MediaBudget,
			userId: UserId,
			input: {file: string; seconds: Option.Option<Duration.Duration>; progress?: TranscriptionProgress}
		) {
			const media = yield* tools.probe(budget, input.file)
			for (const track of Array.filter(media.streams, stream => stream.codec_type === 'subtitle')) {
				const converted = yield* tools.run(
					budget,
					'ffmpeg',
					['-v', 'error', ...LOCAL_ONLY, '-i', input.file, '-map', `0:${track.index}`, '-f', 'webvtt', '-'],
					{output: ByteSize.mebibytes(16), stdin: Option.none()}
				)
				if (converted.exitCode === 0) {
					const transcript = captionTranscript({authored: true, vtt: new TextDecoder().decode(converted.stdout)})
					if (String.isNonEmpty(String.trim(transcript))) return Option.some(transcript)
				}
			}
			if (!Array.some(media.streams, stream => stream.codec_type === 'audio')) return Option.none()
			return yield* pipe(
				input.seconds,
				Option.orElse(() => Option.flatMap(media.format, format => format.duration)),
				Option.filter(
					value =>
						Duration.isGreaterThanOrEqualTo(value, Duration.seconds(1)) &&
						Duration.isLessThanOrEqualTo(value, MAX_TRANSCRIPTION_DURATION)
				),
				Option.match({
					onNone: () => Effect.succeedNone,
					onSome: Effect.fnUntraced(function* (limit) {
						// Partial speech stays useful: every failed chunk is logged; failures with no recovered speech fail the transcription.
						const speech = yield* Effect.mapError(
							Effect.all({authorize: gateway.authorize(userId), url: gateway.apiUrl}, {concurrency: 'unbounded'}),
							cause =>
								MediaError.make({
									cause: Redacted.make(cause),
									message: 'Transcription could not be authorized. Check the AI Gateway account.'
								})
						)
						const work = yield* tools.workspace(budget, 'deslop-speech-')
						// Two-minute s16 mono chunks stay below 4 MiB of FLAC and 5.34 MiB after base64, inside Gateway's 10 MiB body limit.
						const extracted = yield* tools.run(
							budget,
							'ffmpeg',
							[
								'-v',
								'error',
								...LOCAL_ONLY,
								'-i',
								input.file,
								// A TikTok audio track may be the whole song behind a short clip.
								'-t',
								`${Duration.toSeconds(Duration.sum(limit, Duration.seconds(1)))}`,
								'-vn',
								'-map_metadata',
								'-1',
								'-map',
								'0:a:0',
								'-ac',
								'1',
								'-ar',
								'16000',
								'-sample_fmt',
								's16',
								'-c:a',
								'flac',
								'-f',
								'segment',
								'-segment_time',
								'120',
								'-segment_list',
								path.join(work, 'chunks.csv'),
								'-segment_list_type',
								'csv',
								'-reset_timestamps',
								'1',
								path.join(work, 'part-%03d.flac')
							],
							{output: ByteSize.mebibytes(4), stdin: Option.none()}
						)
						if (extracted.exitCode !== 0) {
							return yield* MediaError.make({message: `ffmpeg cannot decode the audio: ${extracted.stderr}`})
						}
						return yield* transcription.withPermit(
							Effect.gen(function* () {
								// Raw FLAC segment headers may omit duration or retain the whole file's duration; the muxer's CSV has the actual boundaries.
								const chunks = yield* pipe(
									String.trim(yield* fs.readFileString(path.join(work, 'chunks.csv'))),
									String.split('\n'),
									Effect.forEach(
										line =>
											Schema.decodeUnknownEffect(
												Schema.Tuple([Schema.String, Schema.FiniteFromString, Schema.FiniteFromString])
											)(String.split(line, ',')),
										{concurrency: 1}
									)
								)
								const total = Option.match(Array.last(chunks), {
									onNone: () => Duration.toSeconds(limit),
									onSome: chunk => chunk[2]
								})
								if (input.progress !== undefined) yield* input.progress(0, total)
								const answers = yield* Effect.forEach(
									chunks,
									Effect.fnUntraced(function* (chunk, index) {
										const duration = Duration.seconds(chunk[2] - chunk[1])
										const transcript = yield* pipe(
											HttpClientRequest.post(
												`${speech.url}/google/v1beta/models/gemini-3.5-flash-lite:generateContent`
											),
											HttpClientRequest.bodyJson({
												contents: [
													{
														parts: [
															{
																// Chunk-local times let recovered sentences keep their place in the original audio.
																text: 'Transcribe all spoken words verbatim in their original language as sentence segments with start times in seconds from the beginning of this audio chunk. Return kind "speech" and its segments. Do not summarize, translate or invent speech. Only for silence or music without speech, return kind "silence".'
															},
															{
																inlineData: {
																	data: Base64.encode(yield* fs.readFile(path.join(work, chunk[0]))),
																	mimeType: 'audio/flac'
																}
															}
														],
														role: 'user'
													}
												],
												generationConfig: {
													maxOutputTokens: 4096,
													responseJsonSchema: Schema.toJsonSchemaDocument(Transcript).schema,
													responseMimeType: 'application/json'
												}
											}),
											Effect.flatMap(speech.authorize(http).execute),
											Effect.flatMap(
												HttpClientResponse.matchStatus({
													'2xx': HttpClientResponse.schemaBodyJson(TranscriptionResponse),
													// Gateway refuses before any provider work, so the remaining chunks would only be refused too.
													401: refused,
													402: refused,
													orElse: response =>
														Effect.fail(
															MediaError.make({
																cause: Redacted.make(response),
																message: `OpenCode Zen answered with status ${response.status}.`
															})
														)
												})
											),
											Effect.timeout('1 minute'),
											Effect.mapError(cause => {
												if (Schema.is(MediaError)(cause)) return cause
												return MediaError.make({
													cause: Redacted.make(cause),
													message: 'OpenCode Zen transcription failed.'
												})
											}),
											Effect.flatMap(response => transcriptOf(response, duration, index)),
											Effect.withSpan('Media.transcribeAudio'),
											Effect.result
										)
										if (Result.isFailure(transcript) && transcript.failure.reason === 'Refused') {
											return yield* transcript.failure
										}
										if (Result.isFailure(transcript)) {
											yield* Effect.logWarning('Audio chunk failed; keeping the other chunks', {
												chunk: index + 1,
												message: transcript.failure.message
											})
										}
										if (input.progress !== undefined) yield* input.progress(chunk[2], total)
										return {duration, transcript}
									}),
									{concurrency: 1}
								)
								const failures = pipe(
									answers,
									Array.map(answer => answer.transcript),
									Array.filter(Result.isFailure),
									Array.map(answer => answer.failure)
								)
								if (failures.length === answers.length) {
									return yield* MediaError.make({
										cause: Redacted.make(failures),
										message: 'Every audio chunk failed or was refused; no transcript was recovered.'
									})
								}
								const text = pipe(
									answers,
									// Codec frame boundaries need not be exactly 120 seconds apart; empty chunks keep their duration too.
									Array.mapAccum(Duration.zero, (offset, chunk) => [
										Duration.sum(offset, chunk.duration),
										Array.map(
											pipe(
												chunk.transcript,
												Result.getSuccess,
												Option.filter(answer => answer.kind === 'speech'),
												Option.map(answer => answer.segments),
												Option.getOrElse(() => [])
											),
											segment => `[${clock(Duration.sum(offset, segment.start))}] ${String.trim(segment.text)}\n`
										)
									]),
									result => Array.flatten(result[1]),
									Array.join('')
								)
								if (String.isEmpty(text) && Array.isReadonlyArrayNonEmpty(failures)) {
									return yield* MediaError.make({
										cause: Redacted.make(failures),
										message: 'Audio chunks failed and no speech was recovered; silence could not be confirmed.'
									})
								}
								return Option.liftPredicate(text, String.isNonEmpty)
							})
						)
					})
				})
			)
		})

		// A caption file is read whole, so one larger than any real track is refused.
		const readCaption = Effect.fnUntraced(function* (file: string) {
			if (ByteSize.isGreaterThan((yield* fs.stat(file)).size, ByteSize.mebibytes(16))) {
				return yield* MediaError.make({message: 'The caption file is too large to read.'})
			}
			return yield* fs.readFileString(file)
		})

		const fetchCaptions = Effect.fnUntraced(function* (
			budget: MediaBudget,
			link: string,
			track: {authored: boolean; language: string}
		) {
			const work = yield* tools.workspace(budget, 'deslop-captions-')
			const result = yield* tools.fetch(budget, link, [
				'--skip-download',
				'--no-simulate',
				...Boolean.match(track.authored, {
					onFalse: () => ['--write-auto-subs', '--no-write-subs'],
					onTrue: () => ['--write-subs', '--no-write-auto-subs']
				}),
				'--sub-langs',
				`^${RegExp.escape(track.language)}$`,
				'--sub-format',
				'vtt/srt/best',
				'--convert-subs',
				'vtt',
				'-o',
				path.join(work, 'captions')
			])
			if (result.exitCode !== 0) {
				if (isBlocked(result.stderr)) return {kind: 'blocked' as const}
				return yield* MediaError.make({message: `yt-dlp cannot download captions: ${result.stderr}`})
			}
			for (const file of yield* fs.readDirectory(work)) {
				if (String.endsWith('.vtt')(file)) {
					const text = captionTranscript({authored: track.authored, vtt: yield* readCaption(path.join(work, file))})
					if (String.isNonEmpty(String.trim(text))) return {kind: 'ready' as const, transcript: text}
				} else if (String.endsWith('.json')(file)) {
					const captions = yield* Schema.decodeEffect(Schema.fromJsonString(CreatorCaptions))(
						yield* readCaption(path.join(work, file))
					)
					const text = pipe(
						captions.utterances,
						Array.map(cue => {
							if (String.isNonEmpty(String.trim(cue.text))) {
								return `[${clock(cue.start_time)}] ${String.trim(cue.text)}\n`
							}
							return ''
						}),
						Array.join('')
					)
					if (String.isNonEmpty(String.trim(text))) return {kind: 'ready' as const, transcript: text}
				}
			}
			return {kind: 'unavailable' as const}
		})

		const transcribe = Effect.fnUntraced(function* (
			budget: MediaBudget,
			userId: UserId,
			link: string,
			media: MediaMetadata,
			video: Option.Option<string>,
			progress: TranscriptionProgress
		) {
			const work = yield* tools.workspace(budget, 'deslop-media-')
			for (const track of captionTracks(media)) {
				// A broken authored track must not hide a working automatic or alternate-language track.
				const captioned = yield* pipe(fetchCaptions(budget, link, track), Effect.scoped, Effect.result)
				if (Result.isFailure(captioned)) {
					yield* Effect.logWarning('Caption track failed; trying another track or audio', captioned.failure)
				} else {
					if (captioned.success.kind === 'ready') return Option.some(captioned.success.transcript)
					if (captioned.success.kind === 'blocked') break
				}
			}
			if (Option.exists(media.duration, seconds => Duration.isGreaterThan(seconds, MAX_TRANSCRIPTION_DURATION))) {
				yield* Effect.logInfo('No captions, and the audio is too long to transcribe')
				return Option.none()
			}

			const args = [
				'-f',
				'bestaudio/best',
				// A direct video link, such as an X clip, reports no length until it is on disk.
				'--max-filesize',
				'500M',
				'-o',
				path.join(work, 'audio.%(ext)s')
			]
			// Download the direct video first; if it fails, try the inspected page once.
			const download = yield* pipe(
				video,
				Option.filter(url => url !== link),
				Option.match({
					onNone: () => tools.fetch(budget, link, args),
					onSome: url =>
						Effect.filterOrElse(
							tools.fetch(budget, url, args),
							result => result.exitCode === 0,
							() => tools.fetch(budget, link, args)
						)
				})
			)
			if (download.exitCode !== 0) {
				return yield* MediaError.make({message: `yt-dlp cannot download the audio: ${download.stderr}`})
			}
			const audio = path.join(
				work,
				yield* pipe(
					Array.findFirst(
						yield* fs.readDirectory(work),
						file =>
							String.startsWith('audio.')(file) && !String.endsWith('.part')(file) && !String.endsWith('.ytdl')(file)
					),
					Effect.fromOption,
					Effect.mapError(cause => MediaError.make({cause, message: 'yt-dlp downloaded no audio'}))
				)
			)
			const seconds = yield* Option.match(media.duration, {
				onNone: () => tools.lengthOf(budget, audio),
				onSome: Effect.succeedSome
			})
			if (!Option.exists(seconds, length => Duration.isLessThanOrEqualTo(length, MAX_TRANSCRIPTION_DURATION))) {
				yield* Effect.logInfo('No captions, and the audio is too long or of unknown length to transcribe')
				return Option.none()
			}
			return yield* listen(budget, userId, {file: audio, progress, seconds})
		})

		return {
			fileTranscript: Effect.fn('Transcripts.fileTranscript')(
				function* (budget: MediaBudget, userId: UserId, file: string) {
					return yield* listen(budget, userId, {file, seconds: Option.none()})
				},
				Effect.scoped,
				tools.withProcesses,
				(effect, budget) => withinDeadline(budget)(effect)
			),
			read: Effect.fn('Transcripts.read')(
				function* (budget: MediaBudget, userId: UserId, link: string, video: Option.Option<string>) {
					const found = yield* tools.inspect(budget, link, video)
					return {
						info: mediaMarkdown(found.media, link),
						title: found.media.title,
						transcript: Effect.fnUntraced(function* (progress: TranscriptionProgress) {
							return yield* pipe(
								transcribe(budget, userId, found.url, found.media, video, progress),
								Effect.scoped,
								tools.withProcesses,
								withinDeadline(budget)
							)
						})
					}
				},
				Effect.scoped,
				tools.withProcesses,
				(effect, budget) => withinDeadline(budget)(effect)
			)
		}
	})
}) {
	static readonly layer = Layer.effect(this, this.make)
}
