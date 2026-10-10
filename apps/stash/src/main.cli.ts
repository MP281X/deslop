import {NodeRuntime, NodeServices} from '@effect/platform-node'

import {
	Array,
	Config,
	Console,
	Crypto,
	Effect,
	FileSystem,
	Layer,
	Logger,
	Option,
	Path,
	Stream,
	String,
	pipe
} from 'effect'

import {Argument, Command, Flag} from 'effect/cli'
import {RpcClient, RpcSerialization} from 'effect/rpc'
import {Socket} from 'effect/socket'

import packageJson from '#package' with {type: 'json'}

import {RpcContracts} from '#rpcs/contracts.ts'

const save = pipe(
	Command.make(
		'save',
		{
			// Positional arguments bind in key order, so entry sorts before output.
			entry: pipe(Argument.String('text'), Argument.withDescription('A link, or the text of a note')),
			output: pipe(
				Argument.Directory('output', {mustExist: false}),
				Argument.withDescription('Directory for note.md and transcript.txt'),
				Argument.withDefault('/tmp/stash')
			),
			server: pipe(
				Flag.String('server'),
				Flag.withDescription('Stash server; defaults to STASH_SERVER, then the tailnet address on dev'),
				Flag.withFallbackConfig(Config.String('STASH_SERVER')),
				Flag.withDefault('https://dev.tailnet-8c4c.ts.net:8443')
			)
		},
		Effect.fnUntraced(function* (input) {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const output = path.resolve(input.output)
			const notePath = path.join(output, 'note.md')
			const transcriptPath = path.join(output, 'transcript.txt')
			yield* fs.makeDirectory(output, {recursive: true})
			// A rerun into the same directory never leaves an older file beside the new one.
			yield* fs.remove(notePath, {force: true})
			yield* fs.remove(transcriptPath, {force: true})
			const note = yield* pipe(
				Effect.gen(function* () {
					const client = yield* RpcClient.make(RpcContracts)
					const saved = yield* client['notes.capture']({
						id: yield* (yield* Crypto.Crypto).randomUUIDv4,
						text: input.entry
					})
					yield* Effect.logInfo('Saved; the server is reading and tagging it, which takes minutes for a long video')
					// The note under its id, or the earlier note of the same post it joined, once tagging has finished.
					return yield* pipe(
						client['notes.watch'](undefined),
						Stream.map(state =>
							Array.findFirst(
								state.notes,
								item => item.id === saved.id || String.includes(String.trim(input.entry))(item.text)
							)
						),
						Stream.filter(found => Option.exists(found, item => item.status !== 'organizing')),
						Stream.runHead,
						Effect.map(Option.flatten),
						Effect.flatMap(Effect.fromOption)
					)
				}),
				Effect.scoped,
				// @effect-diagnostics-next-line strictEffectProvide:off -- The server address comes from this command's flag.
				Effect.provide(
					pipe(
						RpcClient.layerProtocolSocket(),
						Layer.provide(
							Socket.layerWebSocket(pipe(new URL('/api/rpc', input.server).href, String.replace(/^http/u, 'ws')))
						),
						Layer.provide(Socket.layerWebSocketConstructorGlobal),
						Layer.provide(RpcSerialization.layerJson)
					)
				)
			)
			// The note as Markdown: what the AI wrote first, then what the server read, so an agent can quote either.
			const markdown = pipe(
				[
					`# ${note.title}`,
					Array.join(Array.filter([note.author, note.source, note.url ?? ''], String.isNonEmpty), ' · '),
					Array.isReadonlyArrayEmpty(note.tags)
						? ''
						: pipe(
								note.tags,
								Array.map(name => `#${name}`),
								Array.join(' ')
							),
					note.summary,
					String.isEmpty(note.body ?? '') ? '' : `## Notes\n\n${note.body ?? ''}`,
					String.isEmpty(note.topics ?? '') ? '' : `## Topics\n\n${note.topics ?? ''}`,
					String.isEmpty(note.screenText ?? '') ? '' : `## Text in the images\n\n${note.screenText ?? ''}`,
					String.isEmpty(note.content) ? '' : `## Source\n\n${note.content}`,
					String.isEmpty(note.issue) ? '' : `## Issue\n\n${note.issue}`
				],
				Array.filter(String.isNonEmpty),
				Array.join('\n\n')
			)
			yield* fs.writeFileString(notePath, `${markdown}\n`)
			yield* Console.log(`Wrote ${notePath}`)
			yield* Option.match(Option.liftPredicate(note.transcript ?? '', String.isNonEmpty), {
				onNone: () => Effect.void,
				onSome: transcript =>
					Effect.andThen(fs.writeFileString(transcriptPath, transcript), Console.log(`Wrote ${transcriptPath}`))
			})
		})
	),
	Command.withDescription(
		'Save a link or a note to stash and write note.md (title, summary, tags, notes, source text) and transcript.txt with [mm:ss] timestamps. The server reads the link, transcribes its video with published captions or Whisper, and tags it; the CLI waits until it finishes. Needs the tailnet.'
	),
	Command.withExamples([
		{
			command: 'vpx @deslop/stash@latest save https://x.com/poteto/status/2102050467505430555 /tmp/stash/poteto',
			description: 'Save the talk attached to an X post and write its note and transcript.'
		}
	])
)

NodeRuntime.runMain(
	pipe(
		Command.make('stash'),
		Command.withDescription('Save links and notes to stash; the server and iOS app share this package.'),
		Command.withSubcommands([save]),
		Command.run({version: packageJson.version}),
		// Progress and warnings go to stderr, so stdout lists only the files written.
		Effect.provideService(Logger.LogToStderr, true),
		// @effect-diagnostics-next-line strictEffectProvide:off -- This CLI entrypoint owns the single platform Layer and its resource lifetime.
		Effect.provide(NodeServices.layer)
	)
)
