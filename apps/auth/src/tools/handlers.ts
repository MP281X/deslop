import {Effect} from 'effect'

import {CurrentUser} from '@deslop/runtime/shared/auth'

import {ToolContracts} from './contracts.ts'

import {CookieSessions} from '#services/cookie-sessions/service.ts'
import {People} from '#services/people/service.ts'

export const ToolHandlers = ToolContracts.toLayer(
	Effect.gen(function* () {
		const people = yield* People
		const sessions = yield* CookieSessions
		return {
			list_people: Effect.fnUntraced(function* () {
				return {people: yield* people.list(yield* CurrentUser)}
			}),
			list_sessions: Effect.fnUntraced(function* () {
				return {sessions: yield* sessions.list((yield* CurrentUser).id)}
			}),
			remove_person: Effect.fnUntraced(function* (input) {
				return yield* people.remove(input.id, yield* CurrentUser)
			}),
			sign_out_session: Effect.fnUntraced(function* (input) {
				yield* sessions.remove(input.id, (yield* CurrentUser).id)
				return {id: input.id}
			})
		}
	})
)
