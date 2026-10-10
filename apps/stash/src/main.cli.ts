import {NodeRuntime, NodeServices} from '@effect/platform-node'

import {Array, Config, Console, Crypto, Effect, Layer, Logger, Option, Stream, String, pipe} from 'effect'

import {Argument, Command, Flag} from 'effect/cli'
import {RpcClient, RpcSerialization} from 'effect/rpc'
import {Socket} from 'effect/socket'

import packageJson from '#package' with {type: 'json'}

import {RpcContracts} from '#rpcs/contracts.ts'

const save = pipe(
	Command.make(
		'save',
		{
			entry: pipe(Argument.String('text'), Argument.withDescription('A link, or the text of a note')),
			server: pipe(
				Flag.String('server'),
				Flag.withDescription('Stash server; defaults to STASH_SERVER, then the tailnet address on dev'),
				Flag.withFallbackConfig(Config.String('STASH_SERVER')),
				Flag.withDefault('https://dev.tailnet-8c4c.ts.net:8443')
			)
		},
		Effect.fnUntraced(function* (input) {
			const note = yield* pipe(
				Effect.gen(function* () {
					const client = yield* RpcClient.make(RpcContracts)
					const saved = yield* client['notes.capture']({
						id: yield* (yield* Crypto.Crypto).randomUUIDv4,
						text: input.entry
					})
					yield* Effect.logInfo('Saved; the server is reading and tagging it, which takes minutes for a long video')
					// Waits for the note under its id; when it joins an earlier note of the same post, the server's search finds
					// that one. The full note comes once tagging has finished.
					const finished = yield* pipe(
						client['notes.watch'](undefined),
						Stream.mapAccumEffect(
							() => saved.id,
							Effect.fnUntraced(function* (target, event) {
								const current = Array.contains(event.removed, target)
									? Option.getOrElse(Array.head(yield* client['notes.search']({query: input.entry})), () => target)
									: target
								const done = Array.findFirst(
									event.upserted,
									item => item.id === current && item.status !== 'organizing'
								)
								return [current, Option.toArray(Option.map(done, item => item.id))] as const
							})
						),
						Stream.runHead,
						Effect.flatMap(Effect.fromOption)
					)
					return yield* client['notes.get']({id: finished})
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
			// The note as Markdown on stdout: what the AI wrote first, then what the server read, so an agent can quote
			// either.
			yield* Console.log(
				pipe(
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
						String.isEmpty(note.transcript ?? '') ? '' : `## Transcript\n\n${note.transcript ?? ''}`,
						String.isEmpty(note.issue) ? '' : `## Issue\n\n${note.issue}`
					],
					Array.filter(String.isNonEmpty),
					Array.join('\n\n')
				)
			)
		})
	),
	Command.withDescription(
		'Save a link or a note to stash and print it as Markdown: title, summary, tags, notes, source text and the transcript with [mm:ss] timestamps. The server reads the link, transcribes its video with published captions or Whisper, and tags it; the CLI waits until it finishes. Needs the tailnet.'
	),
	Command.withExamples([
		{
			command: 'vpx @deslop/stash@latest save https://x.com/poteto/status/2102050467505430555',
			description: 'Save the talk attached to an X post and print its note and transcript.'
		}
	])
)

NodeRuntime.runMain(
	pipe(
		Command.make('stash'),
		Command.withDescription('Save links and notes to stash; the server and iOS app share this package.'),
		Command.withSubcommands([save]),
		Command.run({version: packageJson.version}),
		// Progress and warnings go to stderr, so stdout holds only the note.
		Effect.provideService(Logger.LogToStderr, true),
		// @effect-diagnostics-next-line strictEffectProvide:off -- This CLI entrypoint owns the single platform Layer and its resource lifetime.
		Effect.provide(NodeServices.layer)
	)
)
