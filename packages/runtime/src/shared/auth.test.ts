import {assert, it} from '@effect/vitest'

import {Effect} from 'effect'

import {signedInSecret} from '#shared/auth.ts'

const HAND_OFF = 'https://auth.example.test/signed-in/stash'

it.effect(
	'reads the session secret Auth hands back, and Auth’s reason when the sign-in failed',
	Effect.fnUntraced(function* () {
		assert.strictEqual(yield* signedInSecret(`${HAND_OFF}?${new URLSearchParams({session: 'secret'})}`), 'secret')
		const refused = yield* Effect.flip(
			signedInSecret(`${HAND_OFF}?${new URLSearchParams({error: 'The sign-in expired; sign in again'})}`)
		)
		assert.deepStrictEqual([refused._tag, refused.message], ['AuthError', 'The sign-in expired; sign in again'])
		assert.strictEqual((yield* Effect.flip(signedInSecret(`${HAND_OFF}?session=`)))._tag, 'SchemaError')
	})
)
