import {STTRequest} from '@effect/ai-openrouter/Generated'
import {NodeServices} from '@effect/platform-node'
import {assert, it} from '@effect/vitest'

import {
	Array,
	ConfigProvider,
	Context,
	Effect,
	FileSystem,
	Layer,
	Option,
	Redacted,
	Ref,
	Schema,
	Sink,
	Stream,
	String,
	pipe
} from 'effect'

import {Base64} from 'effect/encoding'
import {HttpClient, HttpClientResponse} from 'effect/http'
import {ChildProcess, ChildProcessSpawner} from 'effect/process'

import {MediaError} from '#services/media/schema.ts'
import {Media} from '#services/media/service.ts'

const CAPTIONS = 'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nHo preparato le lenticchie.\n'

function argument(command: ChildProcess.StandardCommand, flag: string) {
	return Schema.decodeUnknownSync(Schema.String)(
		Array.getUnsafe(command.args, Option.getOrThrow(Array.findFirstIndex(command.args, word => word === flag)) + 1)
	)
}

function handle(stdout: string, exitCode = 0, stderr = '') {
	return ChildProcessSpawner.makeHandle({
		all: Stream.empty,
		exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(exitCode)),
		getInputFd: () => Sink.drain,
		getOutputFd: () => Stream.empty,
		isRunning: Effect.succeed(false),
		kill: () => Effect.void,
		pid: ChildProcessSpawner.ProcessId(1),
		stderr: Stream.make(new TextEncoder().encode(stderr)),
		stdin: Sink.drain,
		stdout: Stream.make(new TextEncoder().encode(stdout)),
		unref: Effect.succeed(Effect.void)
	})
}

const open = Effect.fnUntraced(function* (
	spawner: typeof ChildProcessSpawner.ChildProcessSpawner.Service,
	client = HttpClient.make(() => Effect.die('Captions must not call hosted speech'))
) {
	return Context.get(
		yield* Layer.build(
			pipe(
				Media.layer,
				Layer.provide(Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner)),
				Layer.provide(Layer.succeed(HttpClient.HttpClient, client)),
				Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({OPENROUTER_API_KEY: 'unit-test-key'})))
			)
		),
		Media
	)
})

const audioSpawner = Effect.fnUntraced(function* () {
	const fs = yield* FileSystem.FileSystem
	return ChildProcessSpawner.make(command =>
		Effect.gen(function* () {
			if (!ChildProcess.isStandardCommand(command)) return yield* Effect.die('Unexpected pipeline')
			const file = yield* pipe(
				Schema.decodeUnknownEffect(Schema.String)(pipe(Array.last(command.args), Option.getOrThrow)),
				Effect.orDie
			)
			if (command.command === 'ffprobe') {
				if (String.endsWith('part-000.flac')(file)) {
					return handle('{"format":{"duration":"300.25"},"streams":[{"index":0,"codec_type":"audio"}]}')
				}
				return handle('{"format":{"duration":"20"},"streams":[{"index":0,"codec_type":"audio"}]}')
			}
			if (command.command === 'ffmpeg' && Array.contains(command.args, 'segment')) {
				yield* fs.writeFile(String.replace('%03d', '000')(file), new Uint8Array([1]))
				yield* fs.writeFile(String.replace('%03d', '001')(file), new Uint8Array([2]))
				return handle('')
			}
			return yield* Effect.die(`Unexpected process: ${command.command}`)
		})
	)
})

it.layer(NodeServices.layer)('Media fallback', test => {
	test.effect(
		'stops caption attempts after rate limiting and removes their temporary files before audio fallback',
		Effect.fnUntraced(function* () {
			const fs = yield* FileSystem.FileSystem
			const attempts = yield* Ref.make(0)
			const directory = yield* Ref.make('')
			const spawner = ChildProcessSpawner.make(command =>
				Effect.gen(function* () {
					if (!ChildProcess.isStandardCommand(command)) return yield* Effect.die('Unexpected pipeline')
					if (Array.contains(command.args, '--dump-single-json')) {
						return handle('{"automatic_captions":{"en":[{}],"it":[{}],"fr":[{}]},"title":"A talk"}')
					}
					if (Array.contains(command.args, '--sub-langs')) {
						yield* Ref.update(attempts, count => count + 1)
						yield* Ref.set(directory, String.replace(/\/captions$/u, '')(argument(command, '-o')))
						return handle('', 1, 'ERROR: HTTP Error 429: Too Many Requests')
					}
					if (Array.contains(command.args, '-f')) {
						assert.isFalse(yield* fs.exists(yield* Ref.get(directory)))
						return handle('', 1, 'audio unavailable')
					}
					return yield* Effect.die('Unexpected process')
				})
			)
			const error = yield* Effect.flip(
				(yield* (yield* open(spawner)).read('https://www.youtube.com/watch?v=one')).transcript
			)
			assert.isTrue(Schema.is(MediaError)(error))
			assert.strictEqual(yield* Ref.get(attempts), 1)
		})
	)

	for (const mode of ['empty', 'failed'] as const) {
		test.effect(
			`uses automatic captions after an ${mode} authored track`,
			Effect.fnUntraced(function* () {
				const fs = yield* FileSystem.FileSystem
				const attempts = yield* Ref.make(0)
				const spawner = ChildProcessSpawner.make(command =>
					Effect.gen(function* () {
						if (!ChildProcess.isStandardCommand(command)) return yield* Effect.die('Unexpected pipeline')
						if (Array.contains(command.args, '--dump-single-json')) {
							return handle(
								'{"language":"it","subtitles":{"it":[{"ext":"vtt"}]},"automatic_captions":{"it":[{"ext":"vtt"}]},"title":"Lentils"}'
							)
						}
						if (Array.contains(command.args, '--sub-langs')) {
							yield* Ref.update(attempts, count => count + 1)
							if (Array.contains(command.args, '--no-write-auto-subs')) {
								if (mode === 'failed') return handle('', 1)
								yield* fs.writeFileString(`${argument(command, '-o')}.it.vtt`, 'WEBVTT\n\n')
							} else {
								yield* fs.writeFileString(`${argument(command, '-o')}.it.vtt`, CAPTIONS)
							}
							return handle('')
						}
						return yield* Effect.die('Working automatic captions must prevent audio extraction')
					})
				)
				assert.deepStrictEqual(
					yield* (yield* (yield* open(spawner)).read('https://www.youtube.com/watch?v=one')).transcript,
					Option.some('[00:01] Ho preparato le lenticchie.\n')
				)
				assert.strictEqual(yield* Ref.get(attempts), 2)
			})
		)
	}

	test.effect(
		'reads TikTok creator-caption JSON without a VTT representation',
		Effect.fnUntraced(function* () {
			const fs = yield* FileSystem.FileSystem
			const spawner = ChildProcessSpawner.make(command =>
				Effect.gen(function* () {
					if (!ChildProcess.isStandardCommand(command)) return yield* Effect.die('Unexpected pipeline')
					if (Array.contains(command.args, '--dump-single-json')) {
						return handle('{"subtitles":{"it":[{"ext":"json"}]},"title":"Lentils"}')
					}
					if (Array.contains(command.args, '--sub-langs')) {
						yield* fs.writeFileString(
							`${argument(command, '-o')}.it.json`,
							'{"utterances":[{"start_time":1000,"text":"Ho preparato le lenticchie."}]}'
						)
						return handle('')
					}
					return yield* Effect.die('Creator captions must prevent audio extraction')
				})
			)
			assert.deepStrictEqual(
				yield* (yield* (yield* open(spawner)).read('https://www.tiktok.com/@cook/video/1')).transcript,
				Option.some('[00:01] Ho preparato le lenticchie.\n')
			)
		})
	)

	test.effect(
		'allows SRT captions instead of requiring a native VTT track',
		Effect.fnUntraced(function* () {
			const fs = yield* FileSystem.FileSystem
			const spawner = ChildProcessSpawner.make(command =>
				Effect.gen(function* () {
					if (!ChildProcess.isStandardCommand(command)) return yield* Effect.die('Unexpected pipeline')
					if (Array.contains(command.args, '--dump-single-json')) {
						return handle('{"subtitles":{"it":[{"ext":"srt"}]},"title":"Lentils"}')
					}
					if (Array.contains(command.args, '--sub-langs')) {
						if (String.includes('srt')(argument(command, '--sub-format'))) {
							yield* fs.writeFileString(`${argument(command, '-o')}.it.vtt`, CAPTIONS)
						}
						return handle('')
					}
					return yield* Effect.die('Convertible SRT captions must prevent audio extraction')
				})
			)
			assert.deepStrictEqual(
				yield* (yield* (yield* open(spawner)).read('https://www.tiktok.com/@cook/video/1')).transcript,
				Option.some('[00:01] Ho preparato le lenticchie.\n')
			)
		})
	)

	test.effect(
		'reads an uploaded subtitle track after an unconvertible track without hosted speech',
		Effect.fnUntraced(function* () {
			const spawner = ChildProcessSpawner.make(command =>
				Effect.gen(function* () {
					if (!ChildProcess.isStandardCommand(command)) return yield* Effect.die('Unexpected pipeline')
					if (command.command === 'ffprobe') {
						return handle(
							'{"format":{"duration":"5"},"streams":[{"index":0,"codec_type":"audio"},{"index":1,"codec_type":"subtitle"},{"index":2,"codec_type":"subtitle"}]}'
						)
					}
					if (command.command === 'ffmpeg' && Array.contains(command.args, 'webvtt')) {
						if (argument(command, '-map') === '0:1') return handle('', 1)
						return handle(CAPTIONS)
					}
					return yield* Effect.die('Embedded subtitles must prevent audio extraction')
				})
			)
			assert.deepStrictEqual(
				yield* (yield* open(spawner)).fileTranscript('upload.mp4'),
				Option.some('[00:01] Ho preparato le lenticchie.\n')
			)
		})
	)

	test.effect(
		'uses Whisper Turbo only as a fallback and offsets chunk timestamps by actual durations',
		Effect.fnUntraced(function* () {
			const calls = yield* Ref.make(0)
			const speech = Array.join(
				Array.makeBy(220, index => `word${index}`),
				' '
			)
			const client = HttpClient.make(request =>
				Effect.gen(function* () {
					assert.strictEqual(request.url, 'https://openrouter.ai/api/v1/audio/transcriptions')
					if (request.body._tag !== 'Uint8Array') return yield* Effect.die('Expected a JSON audio request')
					const payload = yield* pipe(
						Schema.decodeEffect(Schema.fromJsonString(STTRequest))(new TextDecoder().decode(request.body.body)),
						Effect.orDie
					)
					assert.strictEqual(payload.model, 'openai/whisper-large-v3-turbo')
					assert.strictEqual(payload.response_format, 'verbose_json')
					assert.deepStrictEqual(payload.timestamp_granularities, ['segment'])
					const call = yield* Ref.getAndUpdate(calls, value => value + 1)
					assert.deepStrictEqual(payload.input_audio, {data: Base64.encode(new Uint8Array([call + 1])), format: 'flac'})
					if (call === 0) {
						return HttpClientResponse.fromWeb(
							request,
							Response.json({segments: [{end: 300.25, id: 0, start: 0, text: speech}], text: speech})
						)
					}
					return HttpClientResponse.fromWeb(
						request,
						Response.json({
							segments: [{end: 20, id: 0, start: 0, text: 'The final sentence.'}],
							text: 'The final sentence.'
						})
					)
				})
			)
			assert.deepStrictEqual(
				yield* (yield* open(yield* audioSpawner(), client)).fileTranscript('upload.mp4'),
				Option.some(`[00:00] ${speech}\n[05:00] The final sentence.\n`)
			)
			assert.strictEqual(yield* Ref.get(calls), 2)
		})
	)

	test.effect(
		'reports hosted failures without retaining a readable credential-bearing HTTP error',
		Effect.fnUntraced(function* () {
			const error = yield* Effect.flip(
				(yield* open(
					yield* audioSpawner(),
					HttpClient.make(request =>
						Effect.succeed(
							HttpClientResponse.fromWeb(
								request,
								Response.json({error: {code: 402, message: 'No credits'}}, {status: 402})
							)
						)
					)
				)).fileTranscript('upload.mp4')
			)
			assert.isTrue(Schema.is(MediaError)(error))
			assert.isTrue(Redacted.isRedacted(error.cause))
		})
	)
})

it.layer(NodeServices.layer)('Media captions', test => {
	test.effect(
		'reads automatic captions whose language has no -orig suffix or language hint',
		Effect.fnUntraced(function* () {
			const fs = yield* FileSystem.FileSystem
			const downloads = yield* Ref.make(0)
			const spawner = ChildProcessSpawner.make(command =>
				Effect.gen(function* () {
					if (!ChildProcess.isStandardCommand(command)) return yield* Effect.die('Unexpected pipeline')
					if (Array.contains(command.args, '--dump-single-json')) {
						if (!Array.contains(command.args, '--write-auto-subs')) return handle('{"title":"Lentils"}')
						return handle('{"automatic_captions":{"it":[{"ext":null}]},"title":"Lentils"}')
					}
					if (Array.contains(command.args, '--sub-langs')) {
						yield* Ref.update(downloads, count => count + 1)
						yield* fs.writeFileString(`${argument(command, '-o')}.it.vtt`, CAPTIONS)
						return handle('')
					}
					return yield* Effect.die(`Unexpected audio extraction: ${command.command}`)
				})
			)
			assert.deepStrictEqual(
				yield* (yield* (yield* open(spawner)).read('https://www.tiktok.com/@cook/video/1')).transcript,
				Option.some('[00:01] Ho preparato le lenticchie.\n')
			)
			assert.strictEqual(yield* Ref.get(downloads), 1)
		})
	)

	test.effect(
		'tries an available caption language when the reported spoken language has no track',
		Effect.fnUntraced(function* () {
			const fs = yield* FileSystem.FileSystem
			const spawner = ChildProcessSpawner.make(command =>
				Effect.gen(function* () {
					if (!ChildProcess.isStandardCommand(command)) return yield* Effect.die('Unexpected pipeline')
					if (Array.contains(command.args, '--dump-single-json')) {
						return handle('{"language":"fr","subtitles":{"it":[{"ext":"vtt"}]},"title":"Lentils"}')
					}
					if (Array.contains(command.args, '--sub-langs')) {
						if (Option.isSome(String.match(new RegExp(argument(command, '--sub-langs'), 'u'))('it'))) {
							yield* fs.writeFileString(`${argument(command, '-o')}.it.vtt`, CAPTIONS)
						}
						return handle('')
					}
					return yield* Effect.die(`Unexpected audio extraction: ${command.command}`)
				})
			)
			assert.deepStrictEqual(
				yield* (yield* (yield* open(spawner)).read('https://www.youtube.com/watch?v=one')).transcript,
				Option.some('[00:01] Ho preparato le lenticchie.\n')
			)
		})
	)
})
