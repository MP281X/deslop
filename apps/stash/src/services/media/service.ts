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
	Record,
	Schema,
	Semaphore,
	Stream,
	String,
	pipe
} from 'effect'

import {env, pipeline} from '@huggingface/transformers'
import {ChildProcess, ChildProcessSpawner} from 'effect/process'

import {captionTranscript, clock, sourceProxy, speechOnly, sticky} from '#services/media/lib/utils.ts'
import {MediaError} from '#services/media/schema.ts'

const MAX_WHISPER_SECONDS = 2 * 60 * 60

const BLOCKED_ANSWER =
	/not a bot|requir(?:es|ing) login|login required|CONNECT tunnel failed|ProxyError|HTTP Error (?:403|429|5\d\d)|Requested format is not available|timed out/iu

type Metadata = typeof Metadata.Type
const Metadata = Schema.Struct({
	_type: Schema.optionalKey(Schema.String),
	automatic_captions: Schema.optionalKey(Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown))),
	chapters: Schema.optionalKey(
		Schema.NullOr(Schema.Array(Schema.Struct({start_time: Schema.Finite, title: Schema.String})))
	),
	description: Schema.optionalKey(Schema.NullOr(Schema.String)),
	duration: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
	language: Schema.optionalKey(Schema.NullOr(Schema.String)),
	subtitles: Schema.optionalKey(Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown))),
	title: Schema.String,
	upload_date: Schema.optionalKey(Schema.NullOr(Schema.String)),
	uploader: Schema.optionalKey(Schema.NullOr(Schema.String))
})

type Transcription = typeof Transcription.Type
const Transcription = Schema.Struct({
	chunks: Schema.Array(
		Schema.Struct({text: Schema.String, timestamp: Schema.Tuple([Schema.Finite, Schema.NullOr(Schema.Finite)])})
	)
})

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
		readonly fileFrames: (file: string) => Effect.Effect<Uint8Array[], MediaError>
		readonly fileTranscript: (file: string) => Effect.Effect<Option.Option<string>, MediaError>
		readonly frames: (link: string) => Effect.Effect<Uint8Array[], MediaError>
		readonly read: (
			link: string
		) => Effect.Effect<{info: string; transcript: Effect.Effect<Option.Option<string>, MediaError>}, MediaError>
	}
>()('@deslop/stash/services/media/service/Media') {
	static readonly layer = Layer.effect(
		this,
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
			const cache = path.join(
				yield* pipe(
					Config.String('XDG_CACHE_HOME'),
					Config.withDefault(path.join(yield* Config.String('HOME'), '.cache'))
				),
				'deslop',
				'media'
			)
			const whisper = yield* Semaphore.make(1)
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
						while: result => result.exitCode !== 0 && Option.isSome(String.match(BLOCKED_ANSWER)(result.stderr))
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

			const listen = Effect.fnUntraced(function* (input: {
				file: string
				language: Option.Option<string>
				// A TikTok's audio track can be the whole song behind a 12-second clip.
				seconds: Option.Option<number>
			}) {
				const pcm = yield* run('ffmpeg', [
					'-v',
					'error',
					'-i',
					input.file,
					...Option.match(input.seconds, {onNone: () => [], onSome: seconds => ['-t', `${seconds + 1}`]}),
					'-f',
					's16le',
					'-ac',
					'1',
					'-ar',
					'16000',
					'-'
				])
				if (pcm.exitCode !== 0) {
					return yield* MediaError.make({message: `ffmpeg cannot decode the audio: ${pcm.stderr}`})
				}
				const samples = Float32Array.from(
					new Int16Array(pcm.stdout.buffer, pcm.stdout.byteOffset, pcm.stdout.byteLength / 2),
					sample => sample / 32768
				)
				if (samples.length / 16000 > MAX_WHISPER_SECONDS) {
					yield* Effect.logInfo(`${clock(samples.length / 16000)} of audio is too long for Whisper`)
					return Option.none()
				}
				if (samples.length < 16_000) return Option.none()
				env.cacheDir = path.join(cache, 'models')
				const spoken = Option.map(input.language, language => pipe(language, String.split('-'), Array.headNonEmpty))
				const english = Option.contains(spoken, 'en')
				const model = Boolean.match(english, {
					onFalse: () => 'onnx-community/whisper-small',
					onTrue: () => 'onnx-community/whisper-small.en'
				})
				const transcription = yield* whisper.withPermit(
					Effect.scoped(
						Effect.gen(function* () {
							yield* Effect.logInfo(`Transcribing ${clock(samples.length / 16000)} of audio with ${model}`)
							const recognize = yield* Effect.acquireRelease(
								Effect.tryPromise(() => pipeline('automatic-speech-recognition', model, {device: 'cpu', dtype: 'q8'})),
								loaded => Effect.promise(() => loaded.dispose())
							)
							return yield* Schema.decodeUnknownEffect(Transcription)(
								yield* Effect.tryPromise(() =>
									recognize(samples, {
										chunk_length_s: 30,
										language: Boolean.match(english, {
											onFalse: () => Option.getOrUndefined(spoken),
											onTrue: () => undefined
										}),
										return_timestamps: true,
										stride_length_s: 5
									})
								)
							)
						})
					)
				)
				return speechOnly(
					Array.join(
						Array.map(transcription.chunks, chunk => `[${clock(chunk.timestamp[0])}] ${String.trim(chunk.text)}\n`),
						''
					)
				)
			})

			const transcribe = Effect.fnUntraced(function* (link: string, media: Metadata) {
				const work = yield* fs.makeTempDirectoryScoped({prefix: 'deslop-media-'})
				const language = pipe(
					Option.fromNullishOr(media.automatic_captions),
					Option.flatMap(captions => Array.findFirst(Record.keys(captions), String.endsWith('-orig'))),
					Option.map(String.replace(/-orig$/u, '')),
					Option.orElse(() => Option.fromNullishOr(media.language)),
					Option.getOrElse(() => 'en')
				)

				yield* fetch([
					...ytDlpArgs,
					'--skip-download',
					'--write-subs',
					'--write-auto-subs',
					'--sub-langs',
					language,
					'--sub-format',
					'vtt',
					'--convert-subs',
					'vtt',
					'-o',
					path.join(work, 'captions'),
					link
				])
				const captions = `captions.${language}.vtt`
				if (Array.contains(yield* fs.readDirectory(work), captions)) {
					return Option.some(
						captionTranscript({
							authored: Option.exists(Option.fromNullishOr(media.subtitles), subtitles =>
								Record.has(subtitles, language)
							),
							vtt: yield* fs.readFileString(path.join(work, captions))
						})
					)
				}
				if (!Option.exists(Option.fromNullishOr(media.duration), seconds => seconds <= MAX_WHISPER_SECONDS)) {
					yield* Effect.logInfo('No captions, and the audio is too long or of unknown length for Whisper')
					return Option.none()
				}

				const download = yield* fetch([
					...ytDlpArgs,
					'-f',
					'bestaudio/best',
					'-o',
					path.join(work, 'audio.%(ext)s'),
					link
				])
				if (download.exitCode !== 0) {
					return yield* MediaError.make({message: `yt-dlp cannot download the audio: ${download.stderr}`})
				}
				const audio = path.join(
					work,
					yield* pipe(
						Array.findFirst(yield* fs.readDirectory(work), String.startsWith('audio.')),
						Effect.fromOption,
						Effect.mapError(cause => MediaError.make({cause, message: 'yt-dlp downloaded no audio'}))
					)
				)
				return yield* listen({
					file: audio,
					language: Option.some(language),
					seconds: Option.fromNullishOr(media.duration)
				})
			})

			const sample = Effect.fnUntraced(function* (video: string, work: string) {
				const probe = yield* run('ffprobe', [
					'-v',
					'error',
					'-show_entries',
					'format=duration',
					'-of',
					'csv=p=0',
					video
				])
				const seconds = pipe(
					String.trim(new TextDecoder().decode(probe.stdout)),
					Number.parse,
					Option.filter(value => value > 0),
					Option.getOrElse(() => 6)
				)
				const sampled = yield* run('ffmpeg', [
					'-v',
					'error',
					'-i',
					video,
					'-vf',
					`fps=12/${seconds},scale='min(768,iw)':-2`,
					'-frames:v',
					'12',
					'-q:v',
					'5',
					path.join(work, 'frame-%02d.jpg')
				])
				if (sampled.exitCode !== 0) {
					return yield* MediaError.make({message: `ffmpeg cannot sample the video: ${sampled.stderr}`})
				}
				return yield* Effect.forEach(
					Array.sort(Array.filter(yield* fs.readDirectory(work), String.startsWith('frame-')), Order.String),
					file => fs.readFile(path.join(work, file)),
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
						return yield* listen({file, language: Option.none(), seconds: Option.none()})
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
							// YouTube offers no plain mp4 to a server, so the stills come from the smallest video stream from 360p down.
							'bv*[height<=360]/wv*/b',
							'--max-filesize',
							'200M',
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
					function* (link) {
						const dump = yield* fetch([...ytDlpArgs, '--dump-single-json', '--flat-playlist', '--skip-download', link])
						if (dump.exitCode !== 0) {
							return yield* MediaError.make({
								message: `yt-dlp cannot read the video: ${String.replace(/https?:\/\/\S+/gu, '<link>')(dump.stderr)}`
							})
						}
						const media = yield* Schema.decodeEffect(Schema.fromJsonString(Metadata))(
							new TextDecoder().decode(dump.stdout)
						)
						if (media._type === 'playlist') {
							return yield* MediaError.make({message: 'The link holds several videos.'})
						}
						const details = Array.filter(
							[
								media.uploader ?? '',
								pipe(media.upload_date ?? '', String.replace(/^(\d{4})(\d{2})(\d{2})$/u, '$1-$2-$3')),
								pipe(
									Option.fromNullishOr(media.duration),
									Option.map(clock),
									Option.getOrElse(() => String.empty)
								)
							],
							String.isNonEmpty
						)
						const info = Array.join(
							Array.getSomes([
								Option.some(`# ${media.title}\n\n${Array.join(details, ', ')}\n${link}`),
								pipe(
									Option.fromNullishOr(media.description),
									Option.filter(String.isNonEmpty),
									Option.map(description => `## Description\n\n${description}`)
								),
								Option.map(
									Option.fromNullishOr(media.chapters),
									chapters =>
										`## Chapters\n\n${Array.join(
											Array.map(chapters, chapter => `- [${clock(chapter.start_time)}] ${chapter.title}`),
											'\n'
										)}`
								)
							]),
							'\n\n'
						)
						return {info, transcript: withProcesses(Effect.scoped(transcribe(link, media)))}
					},
					Effect.scoped,
					withProcesses
				)
			})
		})
	)
}
