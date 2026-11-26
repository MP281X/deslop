import {Effect, Schema} from 'effect'

import {Tool, Toolkit} from 'effect/ai'

import {requireAdmin} from '@deslop/runtime/server/auth'
import {AuthError, CurrentUser, UserId} from '@deslop/runtime/shared/auth'

import {Person} from '#contracts'

import {People} from '#server/people/service.ts'

export const PeopleTools = Toolkit.make(
	Tool.make('list_people', {
		dependencies: [CurrentUser],
		description: 'List people and access requests. Only admins may list people.',
		failure: AuthError,
		parameters: Tool.EmptyParams,
		success: Schema.Struct({people: Schema.Array(Person)})
	})
		.annotate(Tool.Readonly, true)
		.annotate(Tool.Destructive, false)
		.annotate(Tool.Strict, true),
	Tool.make('remove_person', {
		dependencies: [CurrentUser],
		description:
			'Remove a person and their browser sessions by id. Admins cannot be removed. Tailnet people return on their next request.',
		failure: AuthError,
		parameters: Schema.Struct({id: UserId}),
		success: Person
	})
		.annotate(Tool.Destructive, true)
		.annotate(Tool.Strict, true)
)

export const PeopleToolHandlers = PeopleTools.toLayer(
	Effect.map(People, people => ({
		list_people: Effect.fnUntraced(function* () {
			return {people: yield* people.list(yield* requireAdmin(yield* CurrentUser, 'Only an admin can manage people'))}
		}),
		remove_person: Effect.fnUntraced(function* (input) {
			return yield* people.remove(input.id, yield* requireAdmin(yield* CurrentUser, 'Only an admin can manage people'))
		})
	}))
)
