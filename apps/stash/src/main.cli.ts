import {NodeRuntime, NodeServices} from '@effect/platform-node'

import {Console, Effect, FileSystem, Layer, Logger, Option, Path, pipe} from 'effect'

import {Argument, Command, Flag} from 'effect/cli'
import {FetchHttpClient} from 'effect/http'

import packageJson from '#package' with {type: 'json'}

import {Media} from '#services/media/service.ts'

const media = pipe(
	Command.make(
		'media',
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
		Effect.fnUntraced(function* (input) {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const output = path.resolve(input.output)
			const info = path.join(output, 'info.md')
			const transcript = path.join(output, 'transcript.txt')
			yield* fs.makeDirectory(output, {recursive: true})
			// A rerun into the same directory never leaves an older file beside the new one.
			yield* fs.remove(info, {force: true})
			yield* fs.remove(transcript, {force: true})
			const report = yield* (yield* Media).read({
				language: input.language,
				link: input.link,
				maxWhisperSeconds: Option.none()
			})
			yield* fs.writeFileString(info, report.info)
			yield* Console.log(`Wrote ${info}`)
			yield* Option.match(yield* report.transcript, {
				onNone: () => Effect.void,
				onSome: text =>
					Effect.andThen(
						fs.writeFileString(transcript, text.text),
						Console.log(
							`Wrote ${transcript} from ${text.source === 'captions' ? 'published captions' : 'local Whisper'}`
						)
					)
			})
		})
	),
	Command.withDescription(
		'Write info.md (title, author, date, description, chapters and X post text) and transcript.txt with [mm:ss] timestamps for a video or social post URL. Uses published captions when they exist, otherwise downloads the audio and transcribes it locally with Whisper. Needs ffmpeg on PATH; caches yt-dlp and the model in $XDG_CACHE_HOME/deslop/media, ~/.cache by default.'
	),
	Command.withExamples([
		{
			command: 'vpx @deslop/stash@latest media https://x.com/poteto/status/2102050467505430555 /tmp/media/poteto',
			description: 'Transcribe the talk attached to an X post.'
		}
	])
)

NodeRuntime.runMain(
	pipe(
		Command.make('stash'),
		Command.withDescription('Read what a video or social post says; the stash server and iOS app share this package.'),
		Command.withSubcommands([media]),
		Command.run({version: packageJson.version}),
		Effect.scoped,
		// Progress and warnings go to stderr, so stdout lists only the files written.
		Effect.provideService(Logger.LogToStderr, true),
		// @effect-diagnostics-next-line strictEffectProvide:off -- This CLI entrypoint owns the single platform Layer and its resource lifetime.
		Effect.provide(pipe(Media.layer, Layer.provideMerge(Layer.merge(NodeServices.layer, FetchHttpClient.layer))))
	)
)
