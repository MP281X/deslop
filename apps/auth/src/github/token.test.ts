import {assert, it} from '@effect/vitest'

import {Effect} from 'effect'

import {accessTokenOf} from './token.ts'

it.effect('an accepted code is the token', () =>
	Effect.map(accessTokenOf({access_token: 'token'}), token => assert.equal(token, 'token'))
)

it.effect.each([
	['bad_verification_code', undefined],
	['unverified_user_email', 'access_denied'],
	['incorrect_client_credentials', 'temporarily_unavailable'],
	['temporarily_unavailable', 'temporarily_unavailable']
] as const)('GitHub refusing with %s', refusal =>
	Effect.map(Effect.flip(accessTokenOf({error: refusal[0]})), error => assert.equal(error.error, refusal[1]))
)
