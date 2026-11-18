import {
	Array,
	Boolean,
	Duration,
	Effect,
	Fiber,
	Function,
	Layer,
	Match,
	MutableHashMap,
	Option,
	Schema,
	pipe
} from 'effect'

import {RpcClient, RpcClientError, RpcSerialization} from 'effect/rpc'
import type {RpcMessage} from 'effect/rpc'
import {Socket} from 'effect/socket'

import {layerRpcStreamClient} from '#shared/rpc.ts'

// Far past the slowest answer Scope has measured, a Trips booking read at under 9 seconds; a stream's first value is its answer, so a subscription that answered once has no deadline.
const ANSWER_WITHIN = Duration.minutes(1)

type Waiting = {readonly clientId: number; readonly deadline: Fiber.Fiber<void>; sent: boolean}

// Every request gets its first answer within the deadline or fails: one still waiting for the socket was never sent, and the server is told to stop one it never answered.
const layerAnswerDeadline = Layer.effect(
	RpcClient.Protocol,
	Effect.gen(function* () {
		const protocol = yield* RpcClient.Protocol
		const scope = yield* Effect.scope
		const receivers = MutableHashMap.empty<number, (response: RpcMessage.FromServerEncoded) => Effect.Effect<void>>()
		const waiting = MutableHashMap.empty<number | string, Waiting>()

		function take(requestId: number | string) {
			const request = MutableHashMap.get(waiting, requestId)
			MutableHashMap.remove(waiting, requestId)
			return request
		}

		function expire(clientId: number, requestId: number | string) {
			// Read when the deadline passes, by when an answer may have settled the request.
			return Effect.suspend(() =>
				Option.match(take(requestId), {
					onNone: () => Effect.void,
					onSome: request => {
						const error = RpcClientError.RpcClientError.make({
							reason: Boolean.match(request.sent, {
								onFalse: () => Socket.SocketOpenError.make({cause: 'The socket did not open', kind: 'Timeout'}),
								onTrue: () => Socket.SocketReadError.make({cause: `No answer within ${Duration.format(ANSWER_WITHIN)}`})
							})
						})
						const fail = pipe(
							receivers,
							MutableHashMap.get(clientId),
							Option.match({
								onNone: () => Effect.void,
								// oxlint-disable-next-line @deslop/coding-standards/choices-are-schemas -- An encoded protocol frame, which Effect builds as a plain object too.
								onSome: receive => receive({_tag: 'ClientProtocolError', error, requestIds: [requestId]})
							})
						)
						if (!request.sent) return fail
						return Effect.andThen(
							fail,
							Effect.ignore(
								// oxlint-disable-next-line @deslop/coding-standards/choices-are-schemas -- An encoded protocol frame, which Effect builds as a plain object too.
								protocol.send(clientId, {_tag: 'Interrupt', requestId}),
								{log: 'Warn', message: 'The server was not told to stop an unanswered request'}
							)
						)
					}
				})
			)
		}

		function settle(requestIds: readonly (number | string)[]) {
			return Effect.forEach(
				requestIds,
				requestId =>
					Option.match(take(requestId), {
						onNone: () => Effect.void,
						onSome: request => Fiber.interrupt(request.deadline)
					}),
				{concurrency: 1, discard: true}
			)
		}

		function requestsOf(clientId: number) {
			return pipe(
				MutableHashMap.keys(waiting),
				Array.fromIterable,
				Array.filter(requestId =>
					pipe(
						waiting,
						MutableHashMap.get(requestId),
						Option.exists(request => request.clientId === clientId)
					)
				)
			)
		}

		return RpcClient.Protocol.of({
			...protocol,
			run: (clientId, receive) =>
				Effect.suspend(() => {
					MutableHashMap.set(receivers, clientId, receive)
					return Effect.ensuring(
						// A chunk or exit answers its request; a protocol error or defect ends the requests it names, or all of them.
						protocol.run(clientId, response =>
							pipe(
								response,
								Match.valueTags({
									Chunk: chunk => settle([chunk.requestId]),
									ClientProtocolError: failure => settle(failure.requestIds ?? requestsOf(clientId)),
									Defect: () => settle(requestsOf(clientId)),
									Exit: exit => settle([exit.requestId]),
									Pong: () => Effect.void,
									Request: () => Effect.void
								}),
								Effect.andThen(receive(response))
							)
						),
						Effect.sync(() => MutableHashMap.remove(receivers, clientId))
					)
				}),
			send: (clientId, message, transferables) =>
				Match.valueTags(message, {
					Ack: () => protocol.send(clientId, message, transferables),
					Eof: () => protocol.send(clientId, message, transferables),
					Interrupt: interrupt => Effect.andThen(settle([interrupt.requestId]), protocol.send(clientId, message)),
					Ping: () => protocol.send(clientId, message, transferables),
					Request: request =>
						Effect.gen(function* () {
							const tracked: Waiting = {
								clientId,
								deadline: yield* pipe(expire(clientId, request.id), Effect.delay(ANSWER_WITHIN), Effect.forkIn(scope)),
								sent: false
							}
							MutableHashMap.set(waiting, request.id, tracked)
							yield* Effect.onError(protocol.send(clientId, request, transferables), () => settle([request.id]))
							tracked.sent = true
						})
				})
		})
	})
)

// The one RPC transport of the web and iOS clients: binary frames over a socket that reopens after a drop; iOS supplies its guarded session handshake. A socket that cannot open fails every waiting request and read, so a cold start without a network says so instead of waiting for one.
export function layerSocketProtocol(socket: Layer.Layer<Socket.Socket>) {
	return pipe(
		layerAnswerDeadline,
		// The default ping timeout equals the 5-second ping interval, so any pong delay closes the socket.
		Layer.provide(RpcClient.layerProtocolSocket({pingTimeout: '15 seconds'})),
		Layer.provide(socket),
		Layer.provideMerge(RpcSerialization.layerSchemaBinary()),
		Layer.provideMerge(layerRpcStreamClient)
	)
}

// A write the transport failed: one the socket never sent changed nothing, while a dropped or unanswered one may have taken effect. Neither is sent again.
export class WriteError extends Schema.TaggedError<WriteError>()('WriteError', {
	cause: Schema.Defect(),
	message: Schema.String
}) {}

export function writeOutcome<A, E, R>(write: Effect.Effect<A, E, R>) {
	return Effect.catchIf(
		write,
		(error): error is Extract<E, RpcClientError.RpcClientError> => Schema.is(RpcClientError.RpcClientError)(error),
		error =>
			WriteError.make({
				cause: error,
				message: Boolean.match(Schema.is(Socket.SocketOpenError)(error.reason), {
					onFalse: Function.constant('The server did not answer, so the change may or may not have been made.'),
					onTrue: Function.constant('The server could not be reached, so nothing was changed.')
				})
			})
	)
}
