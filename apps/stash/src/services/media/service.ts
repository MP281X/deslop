import {execPath} from 'node:process'

import {
	Array,
	Boolean,
	Config,
	Context,
	Duration,
	Effect,
	FileSystem,
	Layer,
	Number,
	Option,
	Order,
	Path,
	Random,
	Redacted,
	Result,
	Schema,
	Semaphore,
	Stream,
	String,
	pipe
} from 'effect'

import {Base64} from 'effect/encoding'
import {HttpClient, HttpClientRequest, HttpClientResponse} from 'effect/http'
import {ChildProcess, ChildProcessSpawner} from 'effect/process'

import {AiGateway} from '@deslop/runtime/server/ai'
import {ToolPath} from '@deslop/runtime/server/process'
import type {UserId} from '@deslop/runtime/shared/auth'

import {
	captionTracks,
	captionTranscript,
	clock,
	isBlocked,
	speechOnly,
	mediaMarkdown
} from '#services/media/lib/utils.ts'
import type {Still} from '#services/media/schema.ts'
import {
	CreatorCaptions,
	MediaError,
	Metadata,
	Probe,
	Transcript,
	TranscriptionResponse
} from '#services/media/schema.ts'
import {isYouTube} from '#services/notes/lib/utils.ts'

const MAX_TRANSCRIPTION_DURATION = Duration.hours(2)

const transcriptOf = Effect.fnUntraced(function* (
	response: TranscriptionResponse,
	duration: Duration.Duration,
	index: number
) {
	const candidate = Option.flatMap(response.candidates, Array.head)
	const transcript = pipe(
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
		Option.flatMap(Schema.decodeOption(Schema.fromJsonString(Transcript)))
	)
	if (Option.isNone(transcript)) {
		return yield* MediaError.make({
			message: `Audio chunk has no usable answer (${pipe(
				candidate,
				Option.flatMap(value => value.finishReason),
				Option.getOrElse(() => 'missing or blocked')
			)})`
		})
	}
	const answer = Option.getOrThrow(transcript)
	if (answer.kind === 'silence') return answer
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

// When set, every read of a source exits through this proxy, so sites never see the server's address; `{session}` keeps one exit address per request.
export const sourceProxy = Config.option(Config.String('STASH_PROXY'))

export function sticky(proxy: string, session: string) {
	return String.replaceAll('{session}', session)(proxy)
}

export class Media extends Context.Service<
	Media,
	{
		readonly fileFrames: (file: string) => Effect.Effect<Still[], MediaError>
		readonly fileTranscript: (userId: UserId, file: string) => Effect.Effect<Option.Option<string>, MediaError>
		readonly frames: (link: string) => Effect.Effect<Still[], MediaError>
		readonly read: (
			userId: UserId,
			link: string,
			fallback?: string
		) => Effect.Effect<{info: string; transcript: Effect.Effect<Option.Option<string>, MediaError>}, MediaError>
	}
>()('@deslop/stash/services/media/service/Media') {
	static readonly layer = Layer.effect(
		this,
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
			const locate = yield* ToolPath
			const run = Effect.fn('Media.command')(function* (command: string, args: string[]) {
				yield* Effect.annotateCurrentSpan({command, 'command.arguments': args.length})
				const child = yield* ChildProcess.make(yield* locate(command), args, {stderr: 'pipe', stdout: 'pipe'})
				return yield* Effect.all(
					{
						exitCode: child.exitCode,
						stderr: Stream.mkString(Stream.decodeText(child.stderr)),
						stdout: Stream.mkUint8Array(child.stdout)
					},
					{concurrency: 'unbounded'}
				)
			})
			const transcription = yield* Semaphore.make(1)
			const gateway = yield* AiGateway
			const http = yield* HttpClient.HttpClient

			const ytDlpArgs = [
				'--js-runtimes',
				`node:${execPath}`,
				'--ffmpeg-location',
				yield* locate('ffmpeg'),
				'--no-progress',
				'--no-warnings',
				'--no-playlist'
			]
			const exit = yield* sourceProxy

			// A residential exit can be offline or flagged by the site, so a blocked run retries twice, each time from another exit address.
			const fetch = Effect.fnUntraced(function* (args: string[]) {
				return yield* Effect.repeat(
					Effect.gen(function* () {
						const session = `${yield* Random.nextIntBetween(10_000_000, 99_999_999)}`
						return yield* run(
							'yt-dlp',
							Option.match(exit, {onNone: () => args, onSome: url => ['--proxy', sticky(url, session), ...args]})
						)
					}),
					{
						times: Boolean.match(Option.isSome(exit), {onFalse: () => 0, onTrue: () => 2}),
						while: result => result.exitCode !== 0 && isBlocked(result.stderr)
					}
				)
			})

			function withProcesses<A, E>(
				effect: Effect.Effect<A, E, ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | Path.Path>
			) {
				return pipe(
					effect,
					Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
					Effect.provideService(FileSystem.FileSystem, fs),
					Effect.provideService(Path.Path, path),
					Effect.mapError(cause =>
						pipe(
							cause,
							Option.liftPredicate(Schema.is(MediaError)),
							Option.getOrElse(() => MediaError.make({cause, message: 'Cannot extract the media'}))
						)
					)
				)
			}

			const probe = Effect.fnUntraced(function* (file: string) {
				const result = yield* run('ffprobe', [
					'-v',
					'error',
					'-show_entries',
					'format=duration:stream=index,codec_type',
					'-of',
					'json',
					file
				])
				if (result.exitCode !== 0) {
					return yield* MediaError.make({message: `ffprobe cannot inspect the media: ${result.stderr}`})
				}
				return yield* Schema.decodeEffect(Schema.fromJsonString(Probe))(new TextDecoder().decode(result.stdout))
			})

			const lengthOf = Effect.fnUntraced(function* (file: string) {
				return Option.flatMap((yield* probe(file)).format, format => format.duration)
			})

			const listen = Effect.fnUntraced(function* (
				userId: UserId,
				input: {file: string; seconds: Option.Option<Duration.Duration>}
			) {
				const media = yield* probe(input.file)
				for (const track of Array.filter(media.streams, stream => stream.codec_type === 'subtitle')) {
					const converted = yield* run('ffmpeg', [
						'-v',
						'error',
						'-i',
						input.file,
						'-map',
						`0:${track.index}`,
						'-f',
						'webvtt',
						'-'
					])
					if (converted.exitCode === 0) {
						const transcript = captionTranscript({authored: true, vtt: new TextDecoder().decode(converted.stdout)})
						if (String.isNonEmpty(String.trim(transcript))) return Option.some(transcript)
					}
				}
				if (!Array.some(media.streams, stream => stream.codec_type === 'audio')) return Option.none()
				const seconds = Option.orElse(input.seconds, () => Option.flatMap(media.format, format => format.duration))
				if (
					!Option.exists(
						seconds,
						value =>
							Duration.isGreaterThanOrEqualTo(value, Duration.seconds(1)) &&
							Duration.isLessThanOrEqualTo(value, MAX_TRANSCRIPTION_DURATION)
					)
				) {
					return Option.none()
				}
				const speech = yield* Effect.mapError(
					Effect.all({authorize: gateway.authorize(userId), url: gateway.apiUrl}, {concurrency: 'unbounded'}),
					cause => MediaError.make({cause: Redacted.make(cause), message: cause.message})
				)
				const work = yield* fs.makeTempDirectoryScoped({prefix: 'deslop-speech-'})
				// Two-minute s16 mono chunks stay below 4 MiB of FLAC and 5.34 MiB after base64, inside Gateway's 10 MiB body limit.
				const extracted = yield* run('ffmpeg', [
					'-v',
					'error',
					'-i',
					input.file,
					// A TikTok audio track may be the whole song behind a short clip.
					'-t',
					`${Duration.toSeconds(Duration.sum(Option.getOrThrow(seconds), Duration.seconds(1)))}`,
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
				])
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
						const answers = yield* Effect.forEach(
							chunks,
							Effect.fnUntraced(function* (chunk, index) {
								const duration = Duration.seconds(chunk[2] - chunk[1])
								const transcript = yield* pipe(
									HttpClientRequest.post(`${speech.url}/google/v1beta/models/gemini-3.5-flash-lite:generateContent`),
									HttpClientRequest.bodyJson({
										contents: [
											{
												parts: [
													{
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
									Effect.flatMap(speech.authorize(HttpClient.filterStatusOk(http)).execute),
									Effect.flatMap(HttpClientResponse.schemaBodyJson(TranscriptionResponse)),
									Effect.timeout('1 minute'),
									Effect.mapError(cause =>
										MediaError.make({cause: Redacted.make(cause), message: 'OpenCode Zen transcription failed.'})
									),
									Effect.flatMap(response => transcriptOf(response, duration, index)),
									Effect.withSpan('Media.transcribeAudio'),
									Effect.result
								)
								if (Result.isFailure(transcript)) {
									yield* Effect.logWarning('Audio chunk failed; keeping the other chunks', {
										chunk: index + 1,
										message: transcript.failure.message
									})
								}
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

			const fetchCaptions = Effect.fnUntraced(function* (link: string, track: {authored: boolean; language: string}) {
				const work = yield* fs.makeTempDirectoryScoped({prefix: 'deslop-captions-'})
				const result = yield* fetch([
					...ytDlpArgs,
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
					path.join(work, 'captions'),
					link
				])
				if (result.exitCode !== 0) return {blocked: isBlocked(result.stderr), transcript: Option.none<string>()}
				for (const file of yield* fs.readDirectory(work)) {
					if (String.endsWith('.vtt')(file)) {
						const text = captionTranscript({
							authored: track.authored,
							vtt: yield* fs.readFileString(path.join(work, file))
						})
						if (String.isNonEmpty(String.trim(text))) return {blocked: false, transcript: Option.some(text)}
					} else if (String.endsWith('.json')(file)) {
						const captions = yield* Schema.decodeEffect(Schema.fromJsonString(CreatorCaptions))(
							yield* fs.readFileString(path.join(work, file))
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
						if (String.isNonEmpty(String.trim(text))) return {blocked: false, transcript: Option.some(text)}
					}
				}
				return {blocked: false, transcript: Option.none<string>()}
			})

			const transcribe = Effect.fnUntraced(function* (
				userId: UserId,
				link: string,
				media: Metadata,
				fallback?: string
			) {
				const work = yield* fs.makeTempDirectoryScoped({prefix: 'deslop-media-'})
				for (const track of captionTracks(media)) {
					// A broken authored track must not hide a working automatic or alternate-language track.
					const captioned = yield* pipe(
						fetchCaptions(link, track),
						Effect.scoped,
						Effect.option,
						Effect.map(Option.getOrElse(() => ({blocked: false, transcript: Option.none<string>()})))
					)
					if (Option.isSome(captioned.transcript)) return captioned.transcript
					if (captioned.blocked) break
				}
				if (Option.exists(media.duration, seconds => Duration.isGreaterThan(seconds, MAX_TRANSCRIPTION_DURATION))) {
					yield* Effect.logInfo('No captions, and the audio is too long to transcribe')
					return Option.none()
				}

				const args = [
					...ytDlpArgs,
					'-f',
					'bestaudio/best',
					// A direct video link, such as an X clip, reports no length until it is on disk.
					'--max-filesize',
					'500M',
					'-o',
					path.join(work, 'audio.%(ext)s')
				]
				const download = yield* Effect.filterOrElse(
					fetch([...args, fallback ?? link]),
					result => result.exitCode === 0 || fallback === undefined || fallback === link,
					() => fetch([...args, link])
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
				const seconds = yield* Option.match(media.duration, {onNone: () => lengthOf(audio), onSome: Effect.succeedSome})
				if (!Option.exists(seconds, length => Duration.isLessThanOrEqualTo(length, MAX_TRANSCRIPTION_DURATION))) {
					yield* Effect.logInfo('No captions, and the audio is too long or of unknown length to transcribe')
					return Option.none()
				}
				return yield* listen(userId, {file: audio, seconds})
			})

			const sample = Effect.fnUntraced(function* (video: string, work: string) {
				const length = Option.getOrElse(yield* lengthOf(video), () => Duration.seconds(6))
				const seconds = Duration.toSeconds(length)
				// A still every 15 seconds, 12 to 48 of them, so a short clip shows its captions and a long talk its slides.
				const count = Number.max(12, Number.min(48, Math.ceil(seconds / 15)))
				const sampled = yield* run('ffmpeg', [
					'-v',
					'error',
					'-i',
					video,
					'-vf',
					`fps=${count}/${seconds},scale='min(1024,iw)':-2`,
					'-frames:v',
					`${count}`,
					'-q:v',
					'5',
					path.join(work, 'frame-%02d.jpg')
				])
				if (sampled.exitCode !== 0) {
					return yield* MediaError.make({message: `ffmpeg cannot sample the video: ${sampled.stderr}`})
				}
				return yield* pipe(
					yield* fs.readDirectory(work),
					Array.filter(String.startsWith('frame-')),
					Array.sort(Order.String),
					Effect.forEach(
						(file, index) =>
							Effect.map(fs.readFile(path.join(work, file)), bytes => ({
								bytes,
								seconds: Duration.times(length, index / count)
							})),
						{concurrency: 'unbounded'}
					)
				)
			})

			return Media.of({
				fileFrames: Effect.fn('Media.fileFrames')(
					function* (file) {
						return yield* sample(file, yield* fs.makeTempDirectoryScoped({prefix: 'deslop-media-'}))
					},
					Effect.scoped,
					withProcesses
				),
				fileTranscript: Effect.fn('Media.fileTranscript')(
					function* (userId, file) {
						return yield* listen(userId, {file, seconds: Option.none()})
					},
					Effect.scoped,
					withProcesses
				),
				frames: Effect.fn('Media.frames')(
					function* (link) {
						const work = yield* fs.makeTempDirectoryScoped({prefix: 'deslop-media-'})
						const download = yield* fetch([
							...ytDlpArgs,
							'-f',
							// YouTube offers no plain mp4 to a server, so the stills come from a video-only stream; 480p keeps slide text readable.
							'bv*[height<=480]/wv*/b',
							'--max-filesize',
							'500M',
							'-o',
							path.join(work, 'video.%(ext)s'),
							link
						])
						if (download.exitCode !== 0) {
							return yield* MediaError.make({message: `yt-dlp cannot download the video: ${download.stderr}`})
						}
						const video = path.join(
							work,
							yield* pipe(
								Array.findFirst(yield* fs.readDirectory(work), String.startsWith('video.')),
								Effect.fromOption,
								Effect.mapError(cause => MediaError.make({cause, message: 'yt-dlp downloaded no video'}))
							)
						)
						return yield* sample(video, work)
					},
					Effect.scoped,
					withProcesses
				),
				read: Effect.fn('Media.read')(
					function* (userId, link, fallback) {
						const inspect = Effect.fnUntraced(function* (url: string) {
							const dump = yield* fetch([
								...ytDlpArgs,
								'--dump-single-json',
								'--flat-playlist',
								'--skip-download',
								// Some extractors only expose subtitle metadata when subtitle extraction is requested.
								'--write-subs',
								'--write-auto-subs',
								'--simulate',
								// The top comments hold corrections, answers and pushback; only YouTube can cap how many load.
								...Boolean.match(isYouTube(link), {
									onFalse: () => [],
									onTrue: () => [
										'--write-comments',
										'--extractor-args',
										'youtube:comment_sort=top;max_comments=60,60,0,0'
									]
								}),
								url
							])
							if (dump.exitCode !== 0) {
								return yield* MediaError.make({
									message: `yt-dlp cannot read the video: ${String.replaceAll(/https?:\/\/\S+/gu, '<link>')(dump.stderr)}`
								})
							}
							const media = yield* Schema.decodeEffect(Schema.fromJsonString(Metadata))(
								new TextDecoder().decode(dump.stdout)
							)
							if (Option.contains(media._type, 'playlist')) {
								return yield* MediaError.make({message: 'The link holds several videos.'})
							}
							return {media, url}
						})
						const found = yield* Effect.catch(inspect(link), error => {
							if (fallback !== undefined && fallback !== link) {
								return Effect.andThen(
									Effect.logWarning('The primary media link could not be inspected', error),
									inspect(fallback)
								)
							}
							return Effect.fail(error)
						})
						return {
							info: mediaMarkdown(found.media, link),
							transcript: withProcesses(Effect.scoped(transcribe(userId, found.url, found.media, fallback)))
						}
					},
					Effect.scoped,
					withProcesses
				)
			})
		})
	)
}
