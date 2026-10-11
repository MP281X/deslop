import {NodeRuntime, NodeServices} from '@effect/platform-node'

import {Array, Config, Console, Crypto, Effect, Layer, Logger, Stream, String, pipe} from 'effect'

import {Argument, Command, Flag} from 'effect/cli'
import {RpcClient, RpcSerialization} from 'effect/rpc'
import {Socket} from 'effect/socket'

import packageJson from '#package' with {type: 'json'}

import {RpcContracts} from '#rpcs/contracts.ts'
import {NotesError} from '#services/notes/schema.ts'

function section(title: string, text: string) {
	return String.isEmpty(text) ? '' : `## ${title}\n\n${text}`
}

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
					yield* pipe(
						client['notes.watch'](undefined),
						Stream.filter(event =>
							Array.some(event.upserted, item => item.id === saved.id && item.status !== 'organizing')
						),
						Stream.runHead,
						Effect.timeoutOrElse({
							duration: '2 hours',
							orElse: () =>
								Effect.fail(NotesError.make({message: 'The server did not finish the note within two hours.'}))
						})
					)
					return yield* client['notes.get']({id: saved.id})
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
			yield* Console.log(
				pipe(
					[
						`# ${note.title}`,
						Array.join(Array.filter([note.author, note.source, note.url ?? ''], String.isNonEmpty), ' · '),
						Array.join(
							Array.map(note.tags, name => `#${name}`),
							' '
						),
						note.summary,
						section('Notes', note.body ?? ''),
						section('Topics', note.topics ?? ''),
						section('Text in the images', note.screenText ?? ''),
						section('Source', note.content),
						section('Transcript', note.transcript ?? ''),
						section('Issue', note.issue)
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
		Effect.provideService(Logger.LogToStderr, true),
		// @effect-diagnostics-next-line strictEffectProvide:off -- This CLI entrypoint owns the single platform Layer and its resource lifetime.
		Effect.provide(NodeServices.layer)
	)
)
