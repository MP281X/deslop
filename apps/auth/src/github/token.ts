import {Effect, Schema} from 'effect'

import {AuthError} from '@deslop/runtime/shared/auth'

import {GitHubRefusal} from './contract.ts'
import type {GitHubToken} from './contract.ts'

// Only GitHub's own refusal of the code or the account is the person's to act on; any other refusal is GitHub's or this app's.
export function accessTokenOf(token: GitHubToken) {
	if (!Schema.is(GitHubRefusal)(token)) return Effect.succeed(token.access_token)
	if (token.error === 'bad_verification_code') {
		return Effect.fail(AuthError.make({message: 'The sign-in expired; sign in again'}))
	}
	if (token.error === 'unverified_user_email') {
		return Effect.fail(AuthError.make({error: 'access_denied', message: 'GitHub needs a verified email first'}))
	}
	return Effect.fail(
		AuthError.make({error: 'temporarily_unavailable', message: `GitHub could not finish the sign-in: ${token.error}`})
	)
}
