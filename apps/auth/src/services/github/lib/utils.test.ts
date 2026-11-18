import {NodeCrypto} from '@effect/platform-node'
import {assert, it} from '@effect/vitest'

import {Effect, Option, Result} from 'effect'

import {accessTokenOf, pendingSignIns} from './utils.ts'

import {GitHubOAuthState} from '#services/github/schema.ts'

it.layer(NodeCrypto.layer)(test =>
	test.effect(
		'a started sign-in opens only under its own state and unaltered',
		Effect.fnUntraced(function* () {
			const pending = yield* pendingSignIns
			const state = GitHubOAuthState.make('state')
			const sealed = yield* pending.seal(state, {app: Option.none(), next: 'https://auth.example.test/'}, 'verifier')
			assert.equal((yield* pending.open(state, sealed)).verifier, 'verifier')
			for (const opened of [
				pending.open(GitHubOAuthState.make('other'), sealed),
				pending.open(state, `${sealed}AAAA`),
				pending.open(state, '')
			]) {
				assert.isTrue(Result.isFailure(yield* Effect.result(opened)))
			}
		})
	)
)

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
