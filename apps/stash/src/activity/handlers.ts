import {Effect, Schema} from 'effect'

import {HttpRouter, HttpServerRequest, HttpServerResponse} from 'effect/http'

import {CurrentUser} from '@deslop/runtime/shared/auth'

import {ActivityTarget} from './contract.ts'
import {SaveActivities} from './server.ts'

import {NoteId} from '#notes/contract.ts'

const register = HttpServerRequest.schemaBodyJson(Schema.Struct({token: ActivityTarget.fields.token}))

const noteIdParam = HttpRouter.schemaPathParams(Schema.Struct({id: NoteId}))

// The share extension reports the push token its Live Activity started with.
export const activityHttp = HttpRouter.use(router =>
	Effect.gen(function* () {
		const activities = yield* SaveActivities
		yield* router.add(
			'POST',
			'/api/capture/:id/activity',
			Effect.catchTag(
				Effect.gen(function* () {
					yield* activities.register((yield* CurrentUser).id, (yield* noteIdParam).id, (yield* register).token)
					return HttpServerResponse.empty({status: 204})
				}),
				'SchemaError',
				() => Effect.succeed(HttpServerResponse.empty({status: 422}))
			)
		)
	})
)
