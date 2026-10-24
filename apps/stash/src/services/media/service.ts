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

import type {AutomaticSpeechRecognitionPipeline} from '@huggingface/transformers'
import {Tensor, env, pipeline} from '@huggingface/transformers'
import {ChildProcess, ChildProcessSpawner} from 'effect/process'

import {sourceProxy, sticky} from '#services/media/lib/proxy.ts'
import {captionTranscript, clock, speechOnly} from '#services/media/lib/utils.ts'
import type {Comment, Still} from '#services/media/schema.ts'
import {MediaError, Metadata, Transcription} from '#services/media/schema.ts'

const MAX_WHISPER_SECONDS = 2 * 60 * 60

const BLOCKED_ANSWER =
	/not a bot|requir(?:es|ing) login|login required|CONNECT tunnel failed|ProxyError|HTTP Error (?:403|429|5\d\d)|Requested format is not available|timed out/iu

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

// transformers.js assumes English when no language is given; Whisper's first token after <|startoftranscript|> (50258) names the spoken one.
const detectLanguage = Effect.fnUntraced(function* (
	recognize: AutomaticSpeechRecognitionPipeline,
	samples: Float32Array
) {
	const features = yield* pipe(
		// oxlint-disable-next-line typescript/no-unsafe-return -- transformers.js types the processor's answer as any; the schema below decodes it.
		Effect.tryPromise(() => recognize.processor(samples.subarray(0, 30 * 16_000))),
		Effect.flatMap(Schema.decodeUnknownEffect(Schema.Struct({input_features: Schema.instanceOf(Tensor)})))
	)
	const first = yield* pipe(
		Effect.tryPromise(() =>
			recognize.model.generate({
				decoder_input_ids: [50_258],
				input_features: features.input_features,
				max_new_tokens: 1
			})
		),
		Effect.flatMap(Schema.decodeUnknownEffect(Schema.instanceOf(Tensor)))
	)
	const found = pipe(
		recognize.tokenizer.batch_decode(first, {skip_special_tokens: false}),
		Array.head,
		Option.flatMap(String.match(/<\|([a-z]{2,3})\|>$/u)),
		Option.flatMap(match => Array.get(match, 1))
	)
	yield* Effect.logInfo(`Whisper hears ${Option.getOrElse(found, () => 'an unknown language')}`)
	return found
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
		readonly fileFrames: (file: string) => Effect.Effect<Still[], MediaError>
		readonly fileTranscript: (file: string) => Effect.Effect<Option.Option<string>, MediaError>
		readonly frames: (link: string) => Effect.Effect<Still[], MediaError>
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
			const cache = path.join(yield* pipe(Config.String('TMPDIR'), Config.withDefault('/tmp')), 'deslop', 'stash')
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
							const heard = yield* Option.match(spoken, {
								onNone: () => detectLanguage(recognize, samples),
								onSome: Effect.succeedSome
							})
							return yield* Schema.decodeUnknownEffect(Transcription)(
								yield* Effect.tryPromise(() =>
									recognize(samples, {
										chunk_length_s: 30,
										language: Boolean.match(english, {
											onFalse: () => Option.getOrUndefined(heard),
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

			// Captions in the spoken language beat Whisper; without a known language Whisper detects it rather than assuming English.
			const captionsFor = Effect.fnUntraced(function* (link: string, media: Metadata, language: string, work: string) {
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
				if (!Array.contains(yield* fs.readDirectory(work), captions)) return Option.none<string>()
				return Option.some(
					captionTranscript({
						authored: Option.exists(Option.fromNullishOr(media.subtitles), subtitles =>
							Record.has(subtitles, language)
						),
						vtt: yield* fs.readFileString(path.join(work, captions))
					})
				)
			})

			const lengthOf = Effect.fnUntraced(function* (file: string) {
				const probe = yield* run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file])
				return pipe(
					String.trim(new TextDecoder().decode(probe.stdout)),
					Number.parse,
					Option.filter(value => value > 0)
				)
			})

			const transcribe = Effect.fnUntraced(function* (link: string, media: Metadata) {
				const work = yield* fs.makeTempDirectoryScoped({prefix: 'deslop-media-'})
				const language = pipe(
					Option.fromNullishOr(media.automatic_captions),
					Option.flatMap(captions => Array.findFirst(Record.keys(captions), String.endsWith('-orig'))),
					Option.map(String.replace(/-orig$/u, '')),
					Option.orElse(() => Option.fromNullishOr(media.language)),
					Option.orElse(() =>
						Option.flatMap(Option.fromNullishOr(media.subtitles), subtitles => Array.head(Record.keys(subtitles)))
					)
				)
				const captioned = yield* Option.match(language, {
					onNone: () => Effect.succeedNone,
					onSome: spoken => captionsFor(link, media, spoken, work)
				})
				if (Option.isSome(captioned)) return captioned
				if (Option.exists(Option.fromNullishOr(media.duration), seconds => seconds > MAX_WHISPER_SECONDS)) {
					yield* Effect.logInfo('No captions, and the audio is too long for Whisper')
					return Option.none()
				}

				const download = yield* fetch([
					...ytDlpArgs,
					'-f',
					'bestaudio/best',
					// A direct video link, such as an X clip, reports no length until it is on disk.
					'--max-filesize',
					'500M',
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
				const seconds = yield* Option.match(Option.fromNullishOr(media.duration), {
					onNone: () => lengthOf(audio),
					onSome: Effect.succeedSome
				})
				if (!Option.exists(seconds, length => length <= MAX_WHISPER_SECONDS)) {
					yield* Effect.logInfo('No captions, and the audio is too long or of unknown length for Whisper')
					return Option.none()
				}
				return yield* listen({file: audio, language, seconds})
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
					function* (link) {
						const dump = yield* fetch([
							...ytDlpArgs,
							'--dump-single-json',
							'--flat-playlist',
							'--skip-download',
							// The top comments hold corrections, answers and pushback; only YouTube can cap how many load.
							...Boolean.match(Option.isSome(String.match(YOUTUBE)(link)), {
								onFalse: () => [],
								onTrue: () => [
									'--write-comments',
									'--extractor-args',
									'youtube:comment_sort=top;max_comments=60,60,0,0'
								]
							}),
							link
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
						const details = pipe(
							[
								Option.fromNullishOr(media.uploader),
								Option.map(
									Option.fromNullishOr(media.upload_date),
									String.replace(/^(\d{4})(\d{2})(\d{2})$/u, '$1-$2-$3')
								),
								Option.map(Option.fromNullishOr(media.duration), clock)
							],
							Array.getSomes,
							Array.filter(String.isNonEmpty)
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
								),
								pipe(
									Option.fromNullishOr(media.comments),
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
						return {info, transcript: withProcesses(Effect.scoped(transcribe(link, media)))}
					},
					Effect.scoped,
					withProcesses
				)
			})
		})
	)
}
