import {execPath} from 'node:process'

import {OpenRouterClient} from '@effect/ai-openrouter'

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
	Schema,
	Semaphore,
	Stream,
	String,
	pipe
} from 'effect'

import {Base64} from 'effect/encoding'
import {HttpClient} from 'effect/http'
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
import {CreatorCaptions, MediaError, Metadata, Probe} from '#services/media/schema.ts'
import {isYouTube} from '#services/notes/lib/utils.ts'

const MAX_WHISPER_SECONDS = 2 * 60 * 60

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
				const handle = yield* ChildProcess.make(yield* locate(command), args, {stderr: 'pipe', stdout: 'pipe'})
				return yield* Effect.all(
					{
						exitCode: handle.exitCode,
						stderr: Stream.mkString(Stream.decodeText(handle.stderr)),
						stdout: Stream.mkUint8Array(handle.stdout)
					},
					{concurrency: 'unbounded'}
				)
			})
			const whisper = yield* Semaphore.make(1)
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
							Duration.isLessThanOrEqualTo(value, Duration.seconds(MAX_WHISPER_SECONDS))
					)
				) {
					return Option.none()
				}
				const speech = yield* Effect.mapError(
					Effect.gen(function* () {
						return yield* Effect.provideService(
							OpenRouterClient.make({
								apiUrl: yield* gateway.apiUrl('openrouter'),
								transformClient: yield* gateway.authorize(userId)
							}),
							HttpClient.HttpClient,
							http
						)
					}),
					cause => MediaError.make({cause: Redacted.make(cause), message: cause.message})
				)
				const work = yield* fs.makeTempDirectoryScoped({prefix: 'deslop-speech-'})
				// Five-minute lossless chunks stay below upload limits and the provider's one-minute processing timeout.
				const extracted = yield* run('ffmpeg', [
					'-v',
					'error',
					'-i',
					input.file,
					// A TikTok audio track may be the whole song behind a short clip.
					'-t',
					`${Duration.toSeconds(Duration.sum(Option.getOrThrow(seconds), Duration.seconds(1)))}`,
					'-vn',
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
					'300',
					'-reset_timestamps',
					'1',
					path.join(work, 'part-%03d.flac')
				])
				if (extracted.exitCode !== 0) {
					return yield* MediaError.make({message: `ffmpeg cannot decode the audio: ${extracted.stderr}`})
				}
				return yield* whisper.withPermit(
					Effect.gen(function* () {
						const files = pipe(
							yield* fs.readDirectory(work),
							Array.filter(String.endsWith('.flac')),
							Array.sort(Order.String)
						)
						return speechOnly(
							pipe(
								yield* Effect.forEach(
									files,
									Effect.fnUntraced(function* (file) {
										const duration = Option.getOrThrow(yield* lengthOf(path.join(work, file)))
										const response = yield* pipe(
											speech.client.createAudioTranscriptions({
												payload: {
													input_audio: {data: Base64.encode(yield* fs.readFile(path.join(work, file))), format: 'flac'},
													model: 'openai/whisper-large-v3-turbo',
													response_format: 'verbose_json',
													timestamp_granularities: ['segment']
												}
											}),
											Effect.timeout('1 minute'),
											Effect.mapError(cause =>
												MediaError.make({cause: Redacted.make(cause), message: 'Whisper Turbo transcription failed.'})
											),
											Effect.withSpan('Media.transcribeAudio')
										)
										if (response.segments !== undefined && Array.isReadonlyArrayNonEmpty(response.segments)) {
											return {duration, segments: response.segments}
										}
										return {duration, segments: [{start: 0, text: response.text}]}
									}),
									{concurrency: 1}
								),
								// Codec frame boundaries need not be exactly 300 seconds apart.
								Array.mapAccum(Duration.zero, (offset, chunk) => [
									Duration.sum(offset, chunk.duration),
									Array.map(
										chunk.segments,
										segment =>
											`[${clock(Duration.sum(offset, Duration.seconds(segment.start)))}] ${String.trim(segment.text)}\n`
									)
								]),
								result => Array.flatten(result[1]),
								Array.join('')
							)
						)
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
						Effect.orElseSucceed(() => ({blocked: false, transcript: Option.none<string>()}))
					)
					if (Option.isSome(captioned.transcript)) return captioned.transcript
					if (captioned.blocked) break
				}
				if (
					Option.exists(media.duration, seconds =>
						Duration.isGreaterThan(seconds, Duration.seconds(MAX_WHISPER_SECONDS))
					)
				) {
					yield* Effect.logInfo('No captions, and the audio is too long for Whisper')
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
				if (
					!Option.exists(seconds, length => Duration.isLessThanOrEqualTo(length, Duration.seconds(MAX_WHISPER_SECONDS)))
				) {
					yield* Effect.logInfo('No captions, and the audio is too long or of unknown length for Whisper')
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
							if (fallback !== undefined && fallback !== link) return inspect(fallback)
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
