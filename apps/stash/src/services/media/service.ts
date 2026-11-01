import {OpenRouterClient} from '@effect/ai-openrouter'

import {
	Array,
	Boolean,
	Config,
	Context,
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
import {ChildProcess, ChildProcessSpawner} from 'effect/process'

import {sourceProxy, sticky} from '#services/media/lib/proxy.ts'
import {captionTracks, captionTranscript, clock, isBlocked, speechOnly} from '#services/media/lib/utils.ts'
import type {Comment, Still} from '#services/media/schema.ts'
import {CreatorCaptions, MediaError, Metadata, Probe} from '#services/media/schema.ts'

const MAX_WHISPER_SECONDS = 2 * 60 * 60

const YOUTUBE = /^https?:\/\/(?:[\w-]+\.)?(?:youtube\.com|youtu\.be)\//u

// A pinned comment first, then the most liked.
const byStanding = Order.combine(
	Order.mapInput(Order.flip(Order.Boolean), (comment: Comment) => comment.is_pinned ?? false),
	Order.mapInput(Order.flip(Order.Number), (comment: Comment) => comment.like_count ?? 0)
)

function commentLine(comment: Comment) {
	return Array.join(
		[
			`**${comment.author ?? 'Someone'}**`,
			Boolean.match(comment.author_is_uploader ?? false, {onFalse: () => '', onTrue: () => ' (the uploader)'}),
			Boolean.match(comment.is_pinned ?? false, {onFalse: () => '', onTrue: () => ', pinned'}),
			Option.match(Option.fromNullishOr(comment.like_count), {onNone: () => '', onSome: likes => `, ${likes} likes`}),
			`: ${String.trim(comment.text)}`
		],
		''
	)
}

const run = Effect.fnUntraced(function* (command: string, args: string[]) {
	const handle = yield* ChildProcess.make(command, args, {stderr: 'pipe', stdout: 'pipe'})
	return yield* Effect.all(
		{
			exitCode: handle.exitCode,
			stderr: Stream.mkString(Stream.decodeText(handle.stderr)),
			stdout: Stream.mkUint8Array(handle.stdout)
		},
		{concurrency: 'unbounded'}
	)
})

export class Media extends Context.Service<
	Media,
	{
		readonly fileFrames: (file: string) => Effect.Effect<Still[], MediaError>
		readonly fileTranscript: (file: string) => Effect.Effect<Option.Option<string>, MediaError>
		readonly frames: (link: string) => Effect.Effect<Still[], MediaError>
		readonly read: (
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
			const whisper = yield* Semaphore.make(1)
			const key = yield* Config.option(Config.Redacted('OPENROUTER_API_KEY'))
			const openRouter = yield* OpenRouterClient.make({apiKey: Option.getOrUndefined(key)})
			const ytDlpArgs = ['--js-runtimes', 'node', '--no-progress', '--no-warnings', '--no-playlist']
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

			function withProcesses<A, E>(effect: Effect.Effect<A, E, ChildProcessSpawner.ChildProcessSpawner>) {
				return pipe(
					effect,
					Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
					Effect.mapError(cause =>
						pipe(
							Option.liftPredicate(cause, Schema.is(MediaError)),
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
				return Option.flatMap(Option.fromUndefinedOr((yield* probe(file)).format?.duration), Number.parse)
			})

			const listen = Effect.fnUntraced(function* (input: {file: string; seconds: Option.Option<number>}) {
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
				const seconds = Option.orElse(input.seconds, () =>
					Option.flatMap(Option.fromUndefinedOr(media.format?.duration), Number.parse)
				)
				if (!Option.exists(seconds, value => value >= 1 && value <= MAX_WHISPER_SECONDS)) return Option.none()
				if (Option.isNone(key)) {
					return yield* MediaError.make({
						message: 'No captions, and OPENROUTER_API_KEY is not configured for transcription.'
					})
				}
				const work = yield* fs.makeTempDirectoryScoped({prefix: 'deslop-speech-'})
				// Five-minute lossless chunks stay below upload limits and the provider's one-minute processing timeout.
				const extracted = yield* run('ffmpeg', [
					'-v',
					'error',
					'-i',
					input.file,
					// A TikTok audio track may be the whole song behind a short clip.
					'-t',
					`${Option.getOrThrow(seconds) + 1}`,
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
						const files = Array.sort(
							Array.filter(yield* fs.readDirectory(work), String.endsWith('.flac')),
							Order.String
						)
						return speechOnly(
							pipe(
								yield* Effect.forEach(
									files,
									Effect.fnUntraced(function* (file) {
										const duration = Option.getOrThrow(yield* lengthOf(path.join(work, file)))
										const response = yield* pipe(
											openRouter.client.createAudioTranscriptions({
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
								Array.mapAccum(0, (offset, chunk) => [
									offset + chunk.duration,
									Array.map(
										chunk.segments,
										segment => `[${clock(offset + segment.start)}] ${String.trim(segment.text)}\n`
									)
								]),
								result => Array.flatten(result[1]),
								Array.join('')
							)
						)
					})
				)
			})

			const captionsFor = Effect.fnUntraced(function* (link: string, track: {authored: boolean; language: string}) {
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
				if (result.exitCode !== 0) return Option.none<string>()
				for (const file of yield* fs.readDirectory(work)) {
					if (String.endsWith('.vtt')(file)) {
						const text = captionTranscript({
							authored: track.authored,
							vtt: yield* fs.readFileString(path.join(work, file))
						})
						if (String.isNonEmpty(String.trim(text))) return Option.some(text)
					} else if (String.endsWith('.json')(file)) {
						const captions = yield* Schema.decodeEffect(Schema.fromJsonString(CreatorCaptions))(
							yield* fs.readFileString(path.join(work, file))
						)
						const text = Array.join(
							Array.map(captions.utterances, cue => {
								if (String.isNonEmpty(String.trim(cue.text))) {
									return `[${clock(cue.start_time / 1000)}] ${String.trim(cue.text)}\n`
								}
								return ''
							}),
							''
						)
						if (String.isNonEmpty(String.trim(text))) return Option.some(text)
					}
				}
				return Option.none<string>()
			})

			const transcribe = Effect.fnUntraced(function* (link: string, media: Metadata, fallback?: string) {
				const work = yield* fs.makeTempDirectoryScoped({prefix: 'deslop-media-'})
				for (const track of captionTracks(media)) {
					// A broken authored track must not hide a working automatic or alternate-language track.
					const captioned = Option.flatten(yield* Effect.option(captionsFor(link, track)))
					if (Option.isSome(captioned)) return captioned
				}
				if (Option.exists(Option.fromNullishOr(media.duration), seconds => seconds > MAX_WHISPER_SECONDS)) {
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
				const download = yield* pipe(
					fetch([...args, fallback ?? link]),
					Effect.filterOrElse(
						result => result.exitCode === 0 || fallback === undefined || fallback === link,
						() => fetch([...args, link])
					)
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
				const seconds = yield* Option.match(Option.fromNullishOr(media.duration), {
					onNone: () => lengthOf(audio),
					onSome: Effect.succeedSome
				})
				if (!Option.exists(seconds, length => length <= MAX_WHISPER_SECONDS)) {
					yield* Effect.logInfo('No captions, and the audio is too long or of unknown length for Whisper')
					return Option.none()
				}
				return yield* listen({file: audio, seconds})
			})

			const sample = Effect.fnUntraced(function* (video: string, work: string) {
				const seconds = Option.getOrElse(yield* lengthOf(video), () => 6)
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
				return yield* Effect.forEach(
					Array.sort(Array.filter(yield* fs.readDirectory(work), String.startsWith('frame-')), Order.String),
					(file, index) =>
						Effect.map(fs.readFile(path.join(work, file)), bytes => ({bytes, seconds: (index * seconds) / count})),
					{concurrency: 'unbounded'}
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
					function* (file) {
						return yield* listen({file, seconds: Option.none()})
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
					function* (link, fallback) {
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
								...Boolean.match(Option.isSome(String.match(YOUTUBE)(link)), {
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
							if (media._type === 'playlist') {
								return yield* MediaError.make({message: 'The link holds several videos.'})
							}
							return {media, url}
						})
						const found = yield* Effect.catch(inspect(link), error => {
							if (fallback !== undefined && fallback !== link) return inspect(fallback)
							return Effect.fail(error)
						})
						const details = pipe(
							[
								Option.fromNullishOr(found.media.uploader),
								Option.map(
									Option.fromNullishOr(found.media.upload_date),
									String.replace(/^(\d{4})(\d{2})(\d{2})$/u, '$1-$2-$3')
								),
								Option.map(Option.fromNullishOr(found.media.duration), clock)
							],
							Array.getSomes,
							Array.filter(String.isNonEmpty)
						)
						const info = Array.join(
							Array.getSomes([
								Option.some(`# ${found.media.title}\n\n${Array.join(details, ', ')}\n${link}`),
								pipe(
									Option.fromNullishOr(found.media.description),
									Option.filter(String.isNonEmpty),
									Option.map(description => `## Description\n\n${description}`)
								),
								Option.map(
									Option.fromNullishOr(found.media.chapters),
									chapters =>
										`## Chapters\n\n${Array.join(
											Array.map(chapters, chapter => `- [${clock(chapter.start_time)}] ${chapter.title}`),
											'\n'
										)}`
								),
								pipe(
									Option.fromNullishOr(found.media.comments),
									Option.map(Array.filter(comment => (comment.parent ?? 'root') === 'root')),
									Option.filter(comments => Array.isReadonlyArrayNonEmpty(comments)),
									Option.map(
										comments =>
											`## Top comments\n\n${Array.join(Array.map(Array.take(Array.sort(comments, byStanding), 40), commentLine), '\n\n')}`
									)
								)
							]),
							'\n\n'
						)
						return {info, transcript: withProcesses(Effect.scoped(transcribe(found.url, found.media, fallback)))}
					},
					Effect.scoped,
					withProcesses
				)
			})
		})
	)
}
