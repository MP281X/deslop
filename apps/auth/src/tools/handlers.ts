import {Effect} from 'effect'

import {requireAdmin} from '@deslop/runtime/server/auth'
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
				return {people: yield* people.list(yield* requireAdmin(yield* CurrentUser, 'Only an admin can manage people'))}
			}),
			list_sessions: Effect.fnUntraced(function* () {
				return {sessions: yield* sessions.list((yield* CurrentUser).id)}
			}),
			remove_person: Effect.fnUntraced(function* (input) {
				return yield* people.remove(
					input.id,
					yield* requireAdmin(yield* CurrentUser, 'Only an admin can manage people')
				)
			}),
			sign_out_session: Effect.fnUntraced(function* (input) {
				yield* sessions.remove(input.id, (yield* CurrentUser).id)
				return {id: input.id}
			})
		}
	})
)
