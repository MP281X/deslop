import {
	Array,
	Boolean,
	Config,
	Context,
	Effect,
	FileSystem,
	Layer,
	Match,
	Option,
	Path,
	Record,
	Schema,
	Semaphore,
	Stream,
	String,
	pipe
} from 'effect'

import {env, pipeline} from '@huggingface/transformers'
import {HttpClient, HttpClientResponse} from 'effect/http'
import {ChildProcess, ChildProcessSpawner} from 'effect/process'

import {captionTranscript, clock} from '#services/media/lib/utils.ts'
import type {Transcript} from '#services/media/schema.ts'
import {MediaError} from '#services/media/schema.ts'

type Post = typeof Post.Type
const Post = Schema.Struct({
	author: Schema.Struct({name: Schema.String, screen_name: Schema.String}),
	created_at: Schema.String,
	text: Schema.String
})

type FxTwitter = typeof FxTwitter.Type
const FxTwitter = Schema.Struct({tweet: Schema.Struct({...Post.fields, quote: Schema.optionalKey(Post)})})

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

type OEmbed = typeof OEmbed.Type
const OEmbed = Schema.Struct({author_name: Schema.String, title: Schema.String})

type Transcription = typeof Transcription.Type
const Transcription = Schema.Struct({
	chunks: Schema.Array(
		Schema.Struct({text: Schema.String, timestamp: Schema.Tuple([Schema.Finite, Schema.NullOr(Schema.Finite)])})
	)
})

function postText(post: Post) {
	return `${post.author.name} (@${post.author.screen_name}), ${post.created_at}\n\n${post.text}`
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

// Reads what a video or social post says: its metadata and post text, and a transcript from published captions or,
// without them, from the audio through local Whisper. yt-dlp stays an external binary, because no maintained
// JavaScript extractor covers its sites.
export class Media extends Context.Service<
	Media,
	{
		// The info comes first, so a caller keeps it when the slower transcript fails.
		readonly read: (input: {
			language: Option.Option<string>
			link: string
			// Longer or unknown audio without captions gets no Whisper transcript, because it would hold every core for minutes.
			maxWhisperSeconds: Option.Option<number>
		}) => Effect.Effect<{info: string; transcript: Effect.Effect<Option.Option<Transcript>, MediaError>}, MediaError>
	}
>()('@deslop/stash/services/media/service/Media') {
	static readonly layer = Layer.effect(
		this,
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const client = pipe(yield* HttpClient.HttpClient, HttpClient.filterStatusOk)
			const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
			const cache = path.join(
				yield* pipe(
					Config.String('XDG_CACHE_HOME'),
					Config.withDefault(path.join(yield* Config.String('HOME'), '.cache'))
				),
				'deslop',
				'media'
			)
			// One Whisper run at a time, because each one uses every core, and one yt-dlp install, because both write one file.
			const whisper = yield* Semaphore.make(1)
			const installing = yield* Semaphore.make(1)
			const ytDlp = path.join(cache, 'yt-dlp')
			const ytDlpArgs = ['--js-runtimes', 'node', '--no-progress', '--no-warnings', '--no-playlist']

			const install = installing.withPermit(
				Effect.gen(function* () {
					yield* fs.makeDirectory(cache, {recursive: true})
					if (!(yield* fs.exists(ytDlp))) {
						yield* Effect.logInfo(`Downloading yt-dlp to ${ytDlp}`)
						const partial = `${ytDlp}.partial`
						yield* Stream.run(
							(yield* client.get(
								`https://github.com/yt-dlp/yt-dlp/releases/latest/download/${pipe(
									Match.value({arch: process.arch, platform: process.platform}),
									Match.when({platform: 'darwin'}, () => 'yt-dlp_macos'),
									Match.when({arch: 'arm64'}, () => 'yt-dlp_linux_aarch64'),
									Match.orElse(() => 'yt-dlp_linux')
								)}`
							)).stream,
							fs.sink(partial)
						)
						yield* fs.chmod(partial, 0o755)
						yield* fs.rename(partial, ytDlp)
					}
					yield* run(ytDlp, ['--update'])
				})
			)

			function withProcesses<A, E>(effect: Effect.Effect<A, E, ChildProcessSpawner.ChildProcessSpawner>) {
				return pipe(
					effect,
					Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
					Effect.mapError(cause =>
						Schema.is(MediaError)(cause) ? cause : MediaError.make({cause, message: 'Cannot extract the media'})
					)
				)
			}

			const transcribe = Effect.fnUntraced(function* (input: {
				language: Option.Option<string>
				link: string
				maxWhisperSeconds: Option.Option<number>
				media: Metadata
			}) {
				const media = input.media
				const work = yield* fs.makeTempDirectoryScoped({prefix: 'deslop-media-'})
				function tooLong(seconds: number) {
					return Option.exists(input.maxWhisperSeconds, limit =>
						Option.match(Option.fromNullishOr(media.duration), {onNone: () => true, onSome: () => seconds > limit})
					)
				}

				// The `-orig` automatic track names the spoken language; its plain key is the untranslated track or uploaded
				// captions.
				const language = pipe(
					input.language,
					Option.orElse(() =>
						pipe(
							Option.fromNullishOr(media.automatic_captions),
							Option.flatMap(captions => Array.findFirst(Record.keys(captions), String.endsWith('-orig'))),
							Option.map(String.replace(/-orig$/u, ''))
						)
					),
					Option.orElse(() => Option.fromNullishOr(media.language)),
					Option.getOrElse(() => 'en')
				)

				yield* run(ytDlp, [
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
					input.link
				])
				const captions = `captions.${language}.vtt`
				if (Array.contains(yield* fs.readDirectory(work), captions)) {
					return Option.some({
						source: 'captions' as const,
						text: captionTranscript({
							authored: Option.exists(Option.fromNullishOr(media.subtitles), subtitles =>
								Record.has(subtitles, language)
							),
							vtt: yield* fs.readFileString(path.join(work, captions))
						})
					})
				}
				if (tooLong(media.duration ?? 0)) {
					yield* Effect.logInfo('No captions, and the audio is too long or of unknown length for Whisper here')
					return Option.none()
				}

				const download = yield* run(ytDlp, [
					...ytDlpArgs,
					'-f',
					'bestaudio/best',
					'-o',
					path.join(work, 'audio.%(ext)s'),
					input.link
				])
				if (download.exitCode !== 0) {
					return yield* MediaError.make({message: `yt-dlp cannot download the audio: ${download.stderr}`})
				}
				const pcm = yield* run('ffmpeg', [
					'-v',
					'error',
					'-i',
					path.join(
						work,
						yield* pipe(
							Array.findFirst(yield* fs.readDirectory(work), String.startsWith('audio.')),
							Effect.fromOption,
							Effect.mapError(cause => MediaError.make({cause, message: 'yt-dlp downloaded no audio'}))
						)
					),
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
				// The declared duration can be shorter than the audio, as on a TikTok photo post with a song.
				if (tooLong(samples.length / 16000)) {
					yield* Effect.logInfo(
						`No captions, and ${clock(samples.length / 16000)} of audio is too long for Whisper here`
					)
					return Option.none()
				}
				env.cacheDir = path.join(cache, 'models')
				// Whisper names languages without a region, such as en for en-US.
				const spoken = pipe(language, String.split('-'), Array.headNonEmpty)
				const english = spoken === 'en'
				const model = Boolean.match(english, {
					onFalse: () => 'onnx-community/whisper-small',
					onTrue: () => 'onnx-community/whisper-small.en'
				})
				const transcription = yield* whisper.withPermit(
					Effect.scoped(
						Effect.gen(function* () {
							yield* Effect.logInfo(`Transcribing ${clock(samples.length / 16000)} of audio with ${model}`)
							// The model holds native ONNX sessions, released after each run.
							const recognize = yield* Effect.acquireRelease(
								Effect.tryPromise(() => pipeline('automatic-speech-recognition', model, {device: 'cpu', dtype: 'q8'})),
								loaded => Effect.promise(() => loaded.dispose())
							)
							return yield* Schema.decodeUnknownEffect(Transcription)(
								yield* Effect.tryPromise(() =>
									recognize(samples, {
										chunk_length_s: 30,
										language: Boolean.match(english, {onFalse: () => spoken, onTrue: () => undefined}),
										return_timestamps: true,
										stride_length_s: 5
									})
								)
							)
						})
					)
				)
				return Option.some({
					source: 'whisper' as const,
					text: Array.join(
						Array.map(transcription.chunks, chunk => `[${clock(chunk.timestamp[0])}] ${String.trim(chunk.text)}\n`),
						''
					)
				})
			})

			return Media.of({
				read: Effect.fn('Media.read')(
					function* (input) {
						yield* install

						const post = yield* pipe(
							input.link,
							String.match(/(?:x|twitter)\.com\/([^/]+)\/status\/(\d+)/u),
							Option.map(match =>
								pipe(
									client.get(`https://api.fxtwitter.com/${match[1]}/status/${match[2]}`),
									Effect.flatMap(HttpClientResponse.schemaBodyJson(FxTwitter)),
									Effect.map(body => body.tweet),
									Effect.tapError(cause => Effect.logWarning(`Cannot read the post text: ${cause.message}`)),
									Effect.option
								)
							),
							Effect.transposeOption,
							Effect.map(Option.flatten)
						)

						const dump = yield* run(ytDlp, [
							...ytDlpArgs,
							'--dump-single-json',
							'--flat-playlist',
							'--skip-download',
							input.link
						])
						if (dump.exitCode !== 0) yield* Effect.logWarning(dump.stderr)
						const metadata = yield* pipe(
							Option.liftPredicate(dump, result => result.exitCode === 0),
							Option.map(result =>
								Schema.decodeEffect(Schema.fromJsonString(Metadata))(new TextDecoder().decode(result.stdout))
							),
							Effect.transposeOption
						)
						if (Option.exists(metadata, media => media._type === 'playlist')) {
							return yield* MediaError.make({
								message: `${input.link} holds several videos; pass the URL of a single video, such as an X post's /video/1 link`
							})
						}
						const oembed = yield* pipe(
							Option.liftPredicate(
								input.link,
								url =>
									Option.isNone(metadata) &&
									Option.isSome(pipe(url, String.match(/^https?:\/\/(?:[\w-]+\.)*(?:youtube\.com|youtu\.be)\//u)))
							),
							Option.map(url =>
								pipe(
									client.get('https://www.youtube.com/oembed', {urlParams: {format: 'json', url}}),
									Effect.flatMap(HttpClientResponse.schemaBodyJson(OEmbed))
								)
							),
							Effect.transposeOption
						)
						if (Option.isNone(metadata) && Option.isNone(oembed) && Option.isNone(post)) {
							return yield* MediaError.make({message: `Nothing could be read from ${input.link}`})
						}

						const info = `${Array.join(
							Array.getSomes([
								Option.map(
									metadata,
									media =>
										`# ${media.title}\n\n${Array.join(
											Array.filter(
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
											),
											', '
										)}\n${input.link}`
								),
								Option.map(
									oembed,
									media =>
										`# ${media.title}\n\n${media.author_name}\n${input.link}\n\nyt-dlp could not read this video (its error is in the log), so only oEmbed metadata is available.`
								),
								Option.map(post, tweet => `## Post\n\n${postText(tweet)}`),
								pipe(
									post,
									Option.flatMapNullishOr(tweet => tweet.quote),
									Option.map(quote => `## Quoted post\n\n${postText(quote)}`)
								),
								pipe(
									metadata,
									Option.flatMapNullishOr(media => media.description),
									Option.filter(String.isNonEmpty),
									Option.map(description => `## Description\n\n${description}`)
								),
								pipe(
									metadata,
									Option.flatMapNullishOr(media => media.chapters),
									Option.map(
										chapters =>
											`## Chapters\n\n${Array.join(
												Array.map(chapters, chapter => `- [${clock(chapter.start_time)}] ${chapter.title}`),
												'\n'
											)}`
									)
								)
							]),
							'\n\n'
						)}\n`
						return {
							info,
							transcript: Option.match(metadata, {
								onNone: () => Effect.succeedNone,
								onSome: media => withProcesses(Effect.scoped(transcribe({...input, media})))
							})
						}
					},
					Effect.scoped,
					withProcesses
				)
			})
		})
	)
}
