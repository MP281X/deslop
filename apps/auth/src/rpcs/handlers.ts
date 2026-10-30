import {Effect, Stream} from 'effect'

import {CurrentUser} from '@deslop/runtime/auth/utils'

import {RpcContracts} from '#rpcs/contracts.ts'
import {Connections} from '#services/connections/service.ts'
import {People} from '#services/people/service.ts'
import {SignIns} from '#services/sign-ins/service.ts'
import {Tokens} from '#services/tokens/service.ts'

export const RpcHandlers = RpcContracts.toLayer(
	Effect.gen(function* () {
		const connections = yield* Connections
		const people = yield* People
		const signIns = yield* SignIns
		const tokens = yield* Tokens
		return RpcContracts.of({
			'auth.account': (_, options) => people.account(options.headers),
			'auth.admit': Effect.fnUntraced(function* (input) {
				return yield* people.admit(input, yield* CurrentUser)
			}),
			'auth.answer': Effect.fnUntraced(function* (input) {
				yield* signIns.answer(input, yield* CurrentUser)
			}),
			'auth.apps': () => Stream.unwrap(Effect.map(CurrentUser, tokens.apps)),
			'auth.disconnect': Effect.fnUntraced(function* (input) {
				return yield* tokens.disconnect(input.family, yield* CurrentUser)
			}),
			'auth.lookup': input => signIns.lookup(input.code),
			'auth.mcp.add': Effect.fnUntraced(function* (input) {
				return yield* connections.add(input.url, yield* CurrentUser)
			}),
			'auth.mcp.disconnect': Effect.fnUntraced(function* (input) {
				return yield* connections.disconnect(input.id, yield* CurrentUser)
			}),
			'auth.mcp.remove': Effect.fnUntraced(function* (input) {
				return yield* connections.remove(input.id, yield* CurrentUser)
			}),
			'auth.mcp.servers': () => Stream.unwrap(Effect.map(CurrentUser, connections.watch)),
			'auth.people': () => Stream.unwrap(Effect.map(CurrentUser, people.people)),
			'auth.remove': Effect.fnUntraced(function* (input) {
				return yield* people.remove(input.id, yield* CurrentUser)
			}),
			'auth.wait': (input, options) => signIns.status(input.request, options.headers)
		})
	})
)
