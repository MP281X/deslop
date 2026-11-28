import {NodeCrypto} from '@effect/platform-node'
import {assert, it} from '@effect/vitest'

import {Effect, Option, Result} from 'effect'

import {GitHubOAuthState} from './contract.ts'
import {pendingSignIns} from './pending.ts'

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
