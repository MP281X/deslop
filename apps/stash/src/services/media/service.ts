import {execPath} from 'node:process'

import {
	Array,
	Boolean,
	ByteSize,
	Config,
	Context,
	DateTime,
	Duration,
	Effect,
	FileSystem,
	Function,
	Layer,
	Match,
	Number,
	Option,
	Order,
	Path,
	Random,
	Redacted,
	Ref,
	Result,
	Schema,
	Semaphore,
	Stream,
	String,
	pipe
} from 'effect'
import type {Scope} from 'effect'

import {Base64} from 'effect/encoding'
import {HttpClient, HttpClientRequest, HttpClientResponse} from 'effect/http'
import {Dns} from 'effect/net'
import type {PlatformError} from 'effect/PlatformError'
import {ChildProcess, ChildProcessSpawner} from 'effect/process'

import {AiGateway} from '@deslop/runtime/server/ai'
import {ToolPath} from '@deslop/runtime/server/process'
import {dataDirectory} from '@deslop/runtime/server/store'
import type {UserId} from '@deslop/runtime/shared/auth'

import {
	captionTracks,
	captionTranscript,
	clock,
	isBlocked,
	speechOnly,
	mediaMarkdown,
	withoutProxy,
	ytDlpRun
} from '#services/media/lib/utils.ts'
import type {MediaBudget, Still} from '#services/media/schema.ts'
import {
	CreatorCaptions,
	MediaError,
	MediaMetadata,
	Probe,
	Refusal,
	Transcript,
	TranscriptionResponse
} from '#services/media/schema.ts'
import {isYouTube, publicAddress, sticky} from '#services/notes/lib/utils.ts'
import {NotesError} from '#services/notes/schema.ts'

// A local input opens only files, so a crafted container or playlist cannot make ffmpeg or ffprobe fetch.
const LOCAL_ONLY = ['-protocol_whitelist', 'file']

const MAX_TRANSCRIPTION_DURATION = Duration.hours(2)

const NOTE_DEADLINE = Duration.hours(1)

const NOTE_BYTES = ByteSize.gibibytes(2)

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

function output(stream: Stream.Stream<Uint8Array, PlatformError>, command: string, limit: ByteSize.ByteSize) {
	return Stream.limitBytes<PlatformError | MediaError, never>(stream, limit, () =>
		Stream.fail(MediaError.make({message: `${command} wrote more than Stash reads.`}))
	)
}

// Every media call of a note stops at the note's deadline, however its tools and requests divide the time.
function withinDeadline(budget: MediaBudget) {
	return <A, R>(effect: Effect.Effect<A, MediaError, R>) =>
		Effect.flatMap(DateTime.now, now =>
			Effect.timeoutOrElse(effect, {
				duration: pipe(now, DateTime.distance(budget.deadline), Duration.max(Duration.zero)),
				orElse: () => Effect.fail(MediaError.make({message: "The note's media work ran past its hour."}))
			})
		)
}

// When set, every read of a source exits through this proxy, so sites never see the server's address; `{session}` keeps one exit address per request.
export const sourceProxy = Config.option(Config.Redacted('STASH_PROXY'))

export class Media extends Context.Service<
	Media,
	{
		// One note's allowance for all its media calls; its folder goes with the scope.
		readonly budget: Effect.Effect<MediaBudget, never, Scope.Scope>
		readonly fileFrames: (budget: MediaBudget, file: string) => Effect.Effect<Still[], MediaError>
		readonly fileTranscript: (
			budget: MediaBudget,
			userId: UserId,
			file: string
		) => Effect.Effect<Option.Option<string>, MediaError>
		readonly frames: (budget: MediaBudget, link: string) => Effect.Effect<Still[], MediaError>
		readonly read: (
			budget: MediaBudget,
			userId: UserId,
			link: string,
			video: Option.Option<string>
		) => Effect.Effect<{info: string; transcript: Effect.Effect<Option.Option<string>, MediaError>}, MediaError>
	}
>()('@deslop/stash/services/media/service/Media') {
	static readonly layer = (directory: string) =>
		Layer.effect(
			this,
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem
				const path = yield* Path.Path
				const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
				const locate = yield* ToolPath
				const dns = yield* Dns.Dns
				// The media tools work in the app's own folder, emptied at start, so a run a crash cut short leaves nothing behind.
				const scratch = path.join(directory, 'media')
				yield* fs.remove(scratch, {force: true, recursive: true})
				yield* fs.makeDirectory(scratch, {mode: 0o700, recursive: true})
				const budgets = yield* Ref.make(0)

				// The bytes in the note's folder now; a file or folder a tool or another call removes while it is read counts as gone.
				const used = Effect.fnUntraced(function* (folder: string) {
					const names = yield* pipe(
						fs.readDirectory(folder, {recursive: true}),
						Effect.option,
						Effect.map(Option.getOrElse(Array.empty<string>))
					)
					const sizes = yield* Effect.forEach(
						names,
						name =>
							pipe(
								fs.stat(path.join(folder, name)),
								Effect.option,
								Effect.map(
									Option.match({
										onNone: () => ByteSize.bytes(0),
										onSome: found =>
											Boolean.match(found.type === 'File', {onFalse: () => ByteSize.bytes(0), onTrue: () => found.size})
									})
								)
							),
						{concurrency: 'unbounded'}
					)
					return Array.reduce(sizes, ByteSize.bytes(0), ByteSize.sum)
				})
				// A tool that fills the note's folder past its allowance is stopped while it writes, not found out afterwards.
				const overspent = Effect.fnUntraced(function* (folder: string) {
					while (!ByteSize.isGreaterThan(yield* used(folder), NOTE_BYTES)) yield* Effect.sleep('1 second')
					return yield* MediaError.make({message: `The note's media work outgrew its ${ByteSize.format(NOTE_BYTES)}.`})
				})
				const run = Effect.fn('Media.command')(function* (
					budget: MediaBudget,
					command: string,
					args: string[],
					options: {readonly output: ByteSize.ByteSize; readonly stdin: Option.Option<string>}
				) {
					yield* Effect.annotateCurrentSpan({command, 'command.arguments': args.length})
					yield* fs.makeDirectory(budget.directory, {mode: 0o700, recursive: true})
					const child = yield* ChildProcess.make(yield* locate(command), args, {
						forceKillAfter: Duration.seconds(5),
						stderr: 'pipe',
						stdin: Option.match(options.stdin, {
							onNone: Function.constant('ignore' as const),
							onSome: text => Stream.make(new TextEncoder().encode(text))
						}),
						stdout: 'pipe'
					})
					return yield* pipe(
						Effect.all(
							{
								exitCode: child.exitCode,
								stderr: pipe(output(child.stderr, command, ByteSize.mebibytes(1)), Stream.decodeText, Stream.mkString),
								stdout: Stream.mkUint8Array(output(child.stdout, command, options.output))
							},
							{concurrency: 'unbounded'}
						),
						Effect.raceFirst(overspent(budget.directory)),
						Effect.timeoutOrElse({
							duration: pipe(
								Match.value(command),
								Match.when('yt-dlp', () => Duration.minutes(30)),
								Match.when('ffprobe', () => Duration.minutes(1)),
								Match.orElse(() => Duration.minutes(10))
							),
							orElse: () => Effect.fail(MediaError.make({message: `${command} exceeded its time limit`}))
						})
					)
				}, Effect.scoped)
				// Each call works in its own folder inside the note's.
				const workspace = Effect.fnUntraced(function* (budget: MediaBudget, prefix: string) {
					yield* fs.makeDirectory(budget.directory, {mode: 0o700, recursive: true})
					return yield* fs.makeTempDirectoryScoped({directory: budget.directory, prefix})
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

				// yt-dlp fetches only a link the page reader would read itself; where it connects after that is up to it and the proxy.
				const publicLink = Effect.fnUntraced(function* (link: string) {
					yield* pipe(
						Effect.try({
							catch: cause => NotesError.make({cause, message: 'The media link is invalid.'}),
							try: () => new URL(link)
						}),
						Effect.flatMap(publicAddress),
						Effect.provideService(Dns.Dns, dns),
						Effect.mapError(cause => MediaError.make({cause, message: 'yt-dlp reads only public web links.'}))
					)
				})

				// A residential exit can be offline or flagged by the site, so a blocked run retries twice, each time from another exit address.
				const fetch = Effect.fnUntraced(function* (
					budget: MediaBudget,
					link: string,
					args: string[],
					limit: ByteSize.ByteSize = ByteSize.mebibytes(4)
				) {
					yield* publicLink(link)
					return yield* Effect.repeat(
						Effect.gen(function* () {
							const session = `${yield* Random.nextIntBetween(10_000_000, 99_999_999)}`
							const proxy = Option.map(exit, url => Redacted.value(sticky(url, session)))
							const command = ytDlpRun([...ytDlpArgs, ...args, link], proxy)
							const result = yield* run(budget, 'yt-dlp', command.args, {output: limit, stdin: command.stdin})
							return {
								...result,
								stderr: Option.match(proxy, {
									onNone: () => result.stderr,
									onSome: url => withoutProxy(result.stderr, url)
								})
							}
						}),
						{
							times: Boolean.match(Option.isSome(exit), {onFalse: Function.constant(0), onTrue: Function.constant(2)}),
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

				const probe = Effect.fnUntraced(function* (budget: MediaBudget, file: string) {
					const result = yield* run(
						budget,
						'ffprobe',
						[
							'-v',
							'error',
							...LOCAL_ONLY,
							'-show_entries',
							'format=duration:stream=index,codec_type',
							'-of',
							'json',
							file
						],
						{output: ByteSize.mebibytes(4), stdin: Option.none()}
					)
					if (result.exitCode !== 0) {
						return yield* MediaError.make({message: `ffprobe cannot inspect the media: ${result.stderr}`})
					}
					return yield* Schema.decodeEffect(Schema.fromJsonString(Probe))(new TextDecoder().decode(result.stdout))
				})

				const lengthOf = Effect.fnUntraced(function* (budget: MediaBudget, file: string) {
					return Option.flatMap((yield* probe(budget, file)).format, format => format.duration)
				})

				const listen = Effect.fnUntraced(function* (
					budget: MediaBudget,
					userId: UserId,
					input: {file: string; seconds: Option.Option<Duration.Duration>}
				) {
					const media = yield* probe(budget, input.file)
					for (const track of Array.filter(media.streams, stream => stream.codec_type === 'subtitle')) {
						const converted = yield* run(
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
								const work = yield* workspace(budget, 'deslop-speech-')
								// Two-minute s16 mono chunks stay below 4 MiB of FLAC and 5.34 MiB after base64, inside Gateway's 10 MiB body limit.
								const extracted = yield* run(
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
					const work = yield* workspace(budget, 'deslop-captions-')
					const result = yield* fetch(budget, link, [
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
					video: Option.Option<string>
				) {
					const work = yield* workspace(budget, 'deslop-media-')
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
							onNone: () => fetch(budget, link, args),
							onSome: url =>
								Effect.filterOrElse(
									fetch(budget, url, args),
									result => result.exitCode === 0,
									() => fetch(budget, link, args)
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
									String.startsWith('audio.')(file) &&
									!String.endsWith('.part')(file) &&
									!String.endsWith('.ytdl')(file)
							),
							Effect.fromOption,
							Effect.mapError(cause => MediaError.make({cause, message: 'yt-dlp downloaded no audio'}))
						)
					)
					const seconds = yield* Option.match(media.duration, {
						onNone: () => lengthOf(budget, audio),
						onSome: Effect.succeedSome
					})
					if (!Option.exists(seconds, length => Duration.isLessThanOrEqualTo(length, MAX_TRANSCRIPTION_DURATION))) {
						yield* Effect.logInfo('No captions, and the audio is too long or of unknown length to transcribe')
						return Option.none()
					}
					return yield* listen(budget, userId, {file: audio, seconds})
				})

				const sample = Effect.fnUntraced(function* (budget: MediaBudget, video: string, work: string) {
					const length = yield* Effect.fromOption(yield* lengthOf(budget, video), () =>
						MediaError.make({message: 'The video duration is unknown; frames could not be sampled.'})
					)
					const seconds = Duration.toSeconds(length)
					// A still every 15 seconds, 12 to 48 of them, so a short clip shows its captions and a long talk its slides.
					const count = Number.max(12, Number.min(48, Math.ceil(seconds / 15)))
					const sampled = yield* run(
						budget,
						'ffmpeg',
						[
							'-v',
							'error',
							...LOCAL_ONLY,
							'-i',
							video,
							'-vf',
							`fps=${count}/${seconds},scale='min(1024,iw)':-2`,
							'-frames:v',
							`${count}`,
							'-q:v',
							'5',
							path.join(work, 'frame-%02d.jpg')
						],
						{output: ByteSize.mebibytes(4), stdin: Option.none()}
					)
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
					budget: Effect.withSpan(
						Effect.gen(function* () {
							const folder = path.join(scratch, `note-${yield* Ref.getAndUpdate(budgets, Number.increment)}`)
							yield* Effect.addFinalizer(() =>
								Effect.ignore(fs.remove(folder, {force: true, recursive: true}), {
									log: 'Warn',
									message: "A note's media folder stays until the next start"
								})
							)
							return {deadline: DateTime.addDuration(yield* DateTime.now, NOTE_DEADLINE), directory: folder}
						}),
						'Media.budget'
					),
					fileFrames: Effect.fn('Media.fileFrames')(
						function* (budget, file) {
							return yield* sample(budget, file, yield* workspace(budget, 'deslop-media-'))
						},
						Effect.scoped,
						withProcesses,
						(effect, budget) => withinDeadline(budget)(effect)
					),
					fileTranscript: Effect.fn('Media.fileTranscript')(
						function* (budget, userId, file) {
							return yield* listen(budget, userId, {file, seconds: Option.none()})
						},
						Effect.scoped,
						withProcesses,
						(effect, budget) => withinDeadline(budget)(effect)
					),
					frames: Effect.fn('Media.frames')(
						function* (budget, link) {
							const work = yield* workspace(budget, 'deslop-media-')
							const download = yield* fetch(budget, link, [
								'-f',
								// YouTube offers no plain mp4 to a server, so the stills come from a video-only stream; 480p keeps slide text readable.
								'bv*[height<=480]/wv*/b',
								'--max-filesize',
								'500M',
								'-o',
								path.join(work, 'video.%(ext)s')
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
							return yield* sample(budget, video, work)
						},
						Effect.scoped,
						withProcesses,
						(effect, budget) => withinDeadline(budget)(effect)
					),
					read: Effect.fn('Media.read')(
						function* (budget, userId, link, video) {
							const inspect = Effect.fnUntraced(function* (url: string) {
								const dump = yield* fetch(
									budget,
									url,
									[
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
										})
									],
									// Sixty comments and every format and caption track of a long video fit.
									ByteSize.mebibytes(32)
								)
								if (dump.exitCode !== 0) {
									return yield* MediaError.make({
										message: `yt-dlp cannot read the video: ${String.replaceAll(/https?:\/\/\S+/gu, '<link>')(dump.stderr)}`
									})
								}
								const media = yield* Schema.decodeEffect(Schema.fromJsonString(MediaMetadata))(
									new TextDecoder().decode(dump.stdout)
								)
								if (Option.contains(media._type, 'playlist')) {
									return yield* MediaError.make({message: 'The link holds several videos.'})
								}
								return {media, url}
							})
							const found = yield* Effect.catch(inspect(link), error =>
								pipe(
									video,
									Option.filter(url => url !== link),
									Option.match({
										onNone: () => Effect.fail(error),
										onSome: url =>
											Effect.andThen(
												Effect.logWarning('The primary media link could not be inspected', error),
												inspect(url)
											)
									})
								)
							)
							return {
								info: mediaMarkdown(found.media, link),
								transcript: pipe(
									transcribe(budget, userId, found.url, found.media, video),
									Effect.scoped,
									withProcesses,
									withinDeadline(budget)
								)
							}
						},
						Effect.scoped,
						withProcesses,
						(effect, budget) => withinDeadline(budget)(effect)
					)
				})
			})
		)
}

export const layerMedia = Layer.unwrap(Effect.map(dataDirectory, Media.layer))
