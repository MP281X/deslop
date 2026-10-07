#!/usr/bin/env node

import {NodeRuntime, NodeServices} from '@effect/platform-node'

import {
	Array,
	Boolean,
	Config,
	Console,
	Effect,
	FileSystem,
	Match,
	Option,
	Path,
	Record,
	Schema,
	Stream,
	String,
	pipe
} from 'effect'

import {env, pipeline} from '@huggingface/transformers'
import {Argument, Command, Flag} from 'effect/cli'
import {FetchHttpClient, HttpClient, HttpClientResponse} from 'effect/http'
import {ChildProcess} from 'effect/process'

import packageJson from '#package' with {type: 'json'}
import {captionTranscript, clock} from '#transcript'

class MediaError extends Schema.TaggedError<MediaError>()('MediaError', {
	cause: Schema.optional(Schema.Defect()),
	message: Schema.String
}) {}

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

const cli = pipe(
	Command.make(
		'deslop-media',
		{
			language: pipe(
				Flag.String('language'),
				Flag.withDescription(
					'Spoken language code, such as it; defaults to the original caption language, then the declared language, then English'
				),
				Flag.optional
			),
			// Positional arguments bind in key order, so the URL key sorts before output.
			link: pipe(Argument.String('url'), Argument.withDescription('Video or post URL')),
			output: pipe(
				Argument.Directory('output', {mustExist: false}),
				Argument.withDescription('Directory for info.md and transcript.txt'),
				Argument.withDefault('/tmp/media')
			)
		},
		Effect.fnUntraced(
			function* (input) {
				const fs = yield* FileSystem.FileSystem
				const path = yield* Path.Path
				const client = pipe(yield* HttpClient.HttpClient, HttpClient.filterStatusOk)
				const cache = path.join(
					yield* pipe(
						Config.String('XDG_CACHE_HOME'),
						Config.withDefault(path.join(yield* Config.String('HOME'), '.cache'))
					),
					'deslop',
					'media'
				)
				const output = path.resolve(input.output)
				const transcript = path.join(output, 'transcript.txt')
				const infoPath = path.join(output, 'info.md')
				const work = yield* fs.makeTempDirectoryScoped({prefix: 'deslop-media-'})
				yield* fs.makeDirectory(output, {recursive: true})
				yield* fs.remove(transcript, {force: true})
				yield* fs.remove(infoPath, {force: true})
				yield* fs.makeDirectory(cache, {recursive: true})

				const ytDlp = path.join(cache, 'yt-dlp')
				if (!(yield* fs.exists(ytDlp))) {
					yield* Console.error(`Downloading yt-dlp to ${ytDlp}`)
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
				const ytDlpArgs = ['--js-runtimes', 'node', '--no-progress', '--no-warnings', '--no-playlist']

				const post = yield* pipe(
					input.link,
					String.match(/(?:x|twitter)\.com\/([^/]+)\/status\/(\d+)/u),
					Option.map(match =>
						pipe(
							client.get(`https://api.fxtwitter.com/${match[1]}/status/${match[2]}`),
							Effect.flatMap(HttpClientResponse.schemaBodyJson(FxTwitter)),
							Effect.map(body => body.tweet),
							Effect.tapError(cause => Console.error(`Cannot read the post text: ${cause.message}`)),
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
				if (dump.exitCode !== 0) yield* Console.error(dump.stderr)
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

				yield* fs.writeFileString(
					infoPath,
					`${Array.join(
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
									`# ${media.title}\n\n${media.author_name}\n${input.link}\n\nyt-dlp could not read this video (its error is on stderr), so only oEmbed metadata is available.`
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
				)
				yield* Console.log(`Wrote ${infoPath}`)
				if (Option.isNone(metadata)) return

				// The `-orig` automatic track names the spoken language; its plain key is the untranslated track or uploaded captions.
				const language = pipe(
					input.language,
					Option.orElse(() =>
						pipe(
							metadata,
							Option.flatMapNullishOr(media => media.automatic_captions),
							Option.flatMap(captions => Array.findFirst(Record.keys(captions), String.endsWith('-orig'))),
							Option.map(String.replace(/-orig$/u, ''))
						)
					),
					Option.orElse(() => Option.flatMapNullishOr(metadata, media => media.language)),
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
					yield* fs.writeFileString(
						transcript,
						captionTranscript({
							authored: Option.exists(
								Option.flatMapNullishOr(metadata, media => media.subtitles),
								subtitles => Record.has(subtitles, language)
							),
							vtt: yield* fs.readFileString(path.join(work, captions))
						})
					)
					return yield* Console.log(`Wrote ${transcript} from published captions`)
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
				env.cacheDir = path.join(cache, 'models')
				// Whisper names languages without a region, such as en for en-US.
				const spoken = pipe(language, String.split('-'), Array.headNonEmpty)
				const english = spoken === 'en'
				const model = Boolean.match(english, {
					onFalse: () => 'onnx-community/whisper-small',
					onTrue: () => 'onnx-community/whisper-small.en'
				})
				yield* Console.error(`Transcribing ${clock(samples.length / 16000)} of audio with ${model}`)
				const recognize = yield* Effect.tryPromise(() =>
					pipeline('automatic-speech-recognition', model, {device: 'cpu', dtype: 'q8'})
				)
				yield* fs.writeFileString(
					transcript,
					Array.join(
						Array.map(
							(yield* Schema.decodeUnknownEffect(Transcription)(
								yield* Effect.tryPromise(() =>
									recognize(samples, {
										chunk_length_s: 30,
										language: Boolean.match(english, {onFalse: () => spoken, onTrue: () => undefined}),
										return_timestamps: true,
										stride_length_s: 5
									})
								)
							)).chunks,
							chunk => `[${clock(chunk.timestamp[0])}] ${String.trim(chunk.text)}\n`
						),
						''
					)
				)
				yield* Console.log(`Wrote ${transcript} with local Whisper`)
			},
			Effect.mapError(cause => MediaError.make({cause, message: 'Cannot extract the media'}))
		)
	),
	Command.withDescription(
		'Write info.md (title, author, date, description, chapters and X post text) and transcript.txt with [mm:ss] timestamps for a video or social post URL. Uses published captions when they exist, otherwise downloads the audio and transcribes it locally with Whisper. Needs ffmpeg on PATH; caches yt-dlp and the model in $XDG_CACHE_HOME/deslop/media, ~/.cache by default.'
	),
	Command.withExamples([
		{
			command: 'vpx @deslop/media@latest https://x.com/poteto/status/2102050467505430555 /tmp/media/poteto',
			description: 'Transcribe the talk attached to an X post.'
		}
	])
)

NodeRuntime.runMain(
	pipe(
		cli,
		Command.run({version: packageJson.version}),
		Effect.scoped,
		// @effect-diagnostics-next-line strictEffectProvide:off -- This CLI entrypoint owns the single platform Layer and its resource lifetime.
		Effect.provide([NodeServices.layer, FetchHttpClient.layer])
	)
)
