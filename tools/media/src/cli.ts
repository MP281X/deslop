#!/usr/bin/env node

import {NodeRuntime, NodeServices} from '@effect/platform-node'

import {
	Array,
	Config,
	Console,
	Duration,
	Effect,
	FileSystem,
	Number,
	Option,
	Path,
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
	chapters: Schema.optionalKey(
		Schema.NullOr(Schema.Array(Schema.Struct({start_time: Schema.Finite, title: Schema.String})))
	),
	description: Schema.optionalKey(Schema.NullOr(Schema.String)),
	duration: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
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

function clock(seconds: number) {
	const parts = Duration.parts(Duration.seconds(seconds))
	return `${pipe(`${parts.hours * 60 + parts.minutes}`, String.padStart(2, '0'))}:${pipe(`${parts.seconds}`, String.padStart(2, '0'))}`
}

function ytDlpAsset() {
	if (process.platform === 'darwin') return 'yt-dlp_macos'
	if (process.arch === 'arm64') return 'yt-dlp_linux_aarch64'
	return 'yt-dlp_linux'
}

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
				Flag.withDescription('Spoken language code, such as it; switches to the multilingual Whisper model'),
				Flag.optional
			),
			// Positional arguments bind in key order, so the URL key sorts before output.
			link: pipe(Argument.String('url'), Argument.withDescription('Video or post URL')),
			output: pipe(
				Argument.Directory('output', {mustExist: false}),
				Argument.withDescription('Directory for info.md and transcript.txt'),
				Argument.withDefault('node_modules/.cache/deslop/media')
			)
		},
		Effect.fnUntraced(
			function* (input) {
				const fs = yield* FileSystem.FileSystem
				const path = yield* Path.Path
				const client = pipe(yield* HttpClient.HttpClient, HttpClient.filterStatusOk)
				const home = yield* Config.String('HOME')
				const cache = path.join(
					yield* pipe(Config.String('XDG_CACHE_HOME'), Config.withDefault(path.join(home, '.cache'))),
					'deslop',
					'media'
				)
				const output = path.resolve(input.output)
				yield* fs.makeDirectory(output, {recursive: true})
				yield* fs.makeDirectory(cache, {recursive: true})

				const ytDlp = path.join(cache, 'yt-dlp')
				if (!(yield* fs.exists(ytDlp))) {
					yield* Console.error(`Downloading yt-dlp to ${ytDlp}`)
					const response = yield* client.get(
						`https://github.com/yt-dlp/yt-dlp/releases/latest/download/${ytDlpAsset()}`
					)
					yield* Stream.run(response.stream, fs.sink(ytDlp))
					yield* fs.chmod(ytDlp, 0o755)
				}
				yield* run(ytDlp, ['--update'])
				const ytDlpArgs = ['--js-runtimes', 'node', '--no-progress', '--no-warnings']

				const post = yield* pipe(
					Option.fromNullishOr(/(?:x|twitter)\.com\/([^/]+)\/status\/(\d+)/u.exec(input.link)),
					Option.map(match =>
						pipe(
							client.get(`https://api.fxtwitter.com/${match[1]}/status/${match[2]}`),
							Effect.flatMap(HttpClientResponse.schemaBodyJson(FxTwitter)),
							Effect.map(body => body.tweet)
						)
					),
					Effect.transposeOption
				)

				const dump = yield* run(ytDlp, [...ytDlpArgs, '--dump-single-json', '--skip-download', input.link])
				if (dump.exitCode !== 0) yield* Console.error(dump.stderr)
				const metadata = yield* pipe(
					Option.liftPredicate(dump, result => result.exitCode === 0),
					Option.map(result =>
						Schema.decodeEffect(Schema.fromJsonString(Metadata))(new TextDecoder().decode(result.stdout))
					),
					Effect.transposeOption
				)
				const oembed = yield* pipe(
					Option.liftPredicate(input.link, url => Option.isNone(metadata) && pipe(url, String.includes('youtu'))),
					Option.map(url =>
						pipe(
							client.get(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`),
							Effect.flatMap(HttpClientResponse.schemaBodyJson(OEmbed))
						)
					),
					Effect.transposeOption
				)

				const info = Array.join(
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
								`# ${media.title}\n\n${media.author_name}\n${input.link}\n\nThis host could only read oEmbed metadata; the media skill lists other sources.`
						),
						Option.map(
							post,
							tweet =>
								`## Post\n\n${postText(tweet)}${tweet.quote === undefined ? '' : `\n\n## Quoted post\n\n${postText(tweet.quote)}`}`
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
				)
				yield* fs.writeFileString(path.join(output, 'info.md'), `${info}\n`)
				yield* Console.log(`Wrote ${path.join(output, 'info.md')}`)
				if (Option.isNone(metadata)) return

				yield* run(ytDlp, [
					...ytDlpArgs,
					'--skip-download',
					'--write-subs',
					'--write-auto-subs',
					'--sub-langs',
					'en.*,en',
					'--sub-format',
					'vtt',
					'-o',
					path.join(output, 'captions'),
					input.link
				])
				const transcript = path.join(output, 'transcript.txt')
				const writeCaptions = Effect.fnUntraced(function* (vtt: string) {
					const cues = pipe(
						vtt,
						String.split('\n\n'),
						Array.flatMap(block => {
							const lines = String.split(block, '\n')
							return pipe(
								Array.findFirstIndex(lines, String.includes('-->')),
								Option.map(index => {
									const start = pipe(
										Array.getUnsafe(lines, index),
										String.split(' --> '),
										Array.headNonEmpty,
										String.split(':'),
										Array.map(Number.parse),
										Array.getSomes
									)
									const seconds = Array.reduce(start, 0, (total, part) => total * 60 + part)
									return Array.map(Array.drop(lines, index + 1), line => ({
										seconds,
										text: String.trim(String.replace(/<[^>]+>/gu, '')(line))
									}))
								}),
								Option.getOrElse(Array.empty)
							)
						}),
						Array.filter(cue => String.isNonEmpty(cue.text)),
						Array.dedupeAdjacentWith((left, right) => left.text === right.text)
					)
					yield* fs.writeFileString(
						transcript,
						Array.join(
							Array.map(cues, cue => `[${clock(cue.seconds)}] ${cue.text}\n`),
							''
						)
					)
					yield* Console.log(`Wrote ${transcript} from published captions`)
				})
				const captions = Array.findFirst(
					yield* fs.readDirectory(output),
					name => pipe(name, String.startsWith('captions')) && pipe(name, String.endsWith('.vtt'))
				)
				const captioned = yield* pipe(
					captions,
					Option.map(name => pipe(fs.readFileString(path.join(output, name)), Effect.flatMap(writeCaptions))),
					Effect.transposeOption
				)
				if (Option.isSome(captioned)) return

				yield* run(ytDlp, [...ytDlpArgs, '-f', 'bestaudio/best', '-o', path.join(output, 'audio.%(ext)s'), input.link])
				const audio = yield* pipe(
					Array.findFirst(yield* fs.readDirectory(output), String.startsWith('audio.')),
					Effect.fromOption,
					Effect.mapError(cause => MediaError.make({cause, message: 'yt-dlp downloaded no audio'}))
				)
				const pcm = yield* run('ffmpeg', [
					'-v',
					'error',
					'-i',
					path.join(output, audio),
					'-f',
					's16le',
					'-ac',
					'1',
					'-ar',
					'16000',
					'-'
				])
				const samples = Float32Array.from(
					new Int16Array(pcm.stdout.buffer, pcm.stdout.byteOffset, pcm.stdout.byteLength / 2),
					sample => sample / 32768
				)
				env.cacheDir = path.join(cache, 'models')
				const model = Option.match(input.language, {
					onNone: () => 'onnx-community/whisper-small.en',
					onSome: () => 'onnx-community/whisper-small'
				})
				yield* Console.error(`Transcribing ${clock(samples.length / 16000)} of audio with ${model}`)
				const recognize = yield* Effect.tryPromise(() =>
					pipeline('automatic-speech-recognition', model, {device: 'cpu', dtype: 'q8'})
				)
				const result = yield* Effect.tryPromise(() =>
					recognize(samples, {
						chunk_length_s: 30,
						language: Option.getOrUndefined(input.language),
						return_timestamps: true,
						stride_length_s: 5
					})
				)
				const chunks = (yield* Schema.decodeUnknownEffect(Transcription)(result)).chunks
				yield* fs.writeFileString(
					transcript,
					Array.join(
						Array.map(chunks, chunk => `[${clock(chunk.timestamp[0])}] ${String.trim(chunk.text)}\n`),
						''
					)
				)
				yield* Console.log(`Wrote ${transcript} with local Whisper`)
			},
			Effect.mapError(cause => MediaError.make({cause, message: 'Cannot extract the media'}))
		)
	),
	Command.withDescription(
		'Write info.md (title, author, date, description, chapters and X post text) and transcript.txt with [mm:ss] timestamps for a video or social post URL. Uses published captions when they exist, otherwise downloads the audio and transcribes it locally with Whisper. Needs ffmpeg on PATH; caches yt-dlp and the model in ~/.cache/deslop/media.'
	),
	Command.withExamples([
		{
			command:
				'vpx @deslop/media@latest https://x.com/poteto/status/2102050467505430555 node_modules/.cache/deslop/media/poteto',
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
