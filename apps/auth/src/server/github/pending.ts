import {Cause, DateTime, Effect, Schema, pipe} from 'effect'

import {Aead, SecureRandom} from 'effect/crypto'
import {Base64Url} from 'effect/encoding'

import {AuthError} from '@deslop/runtime/shared/auth'

import {PendingSignInJson} from '#server/github/schema.ts'
import type {GitHubOAuthState, SignInParams} from '#server/github/schema.ts'

// XChaCha20-Poly1305 takes random nonces of this many bytes.
const NONCE = 24

// A started sign-in travels sealed under a key only this process holds, with its state as additional data, so a cookie opens only under the state it was issued for, unaltered and for ten minutes.
export const pendingSignIns = Effect.gen(function* () {
	const aead = yield* Aead.Aead
	const random = yield* SecureRandom.SecureRandom
	const key = yield* aead.generateKey(Aead.xchacha20Poly1305)
	return {
		open: Effect.fn('GitHub.resume')(
			function* (state: GitHubOAuthState, sealed: string) {
				const bytes = yield* Effect.fromResult(Base64Url.decode(sealed))
				const now = yield* DateTime.now
				return yield* pipe(
					aead.decrypt(key, bytes.subarray(NONCE), {
						aad: new TextEncoder().encode(state),
						nonce: bytes.subarray(0, NONCE)
					}),
					Effect.flatMap(plain => Schema.decodeEffect(PendingSignInJson)(new TextDecoder().decode(plain))),
					Effect.filterOrFail(
						pending => DateTime.isGreaterThan(pending.expires, now),
						() => new Cause.NoSuchElementError('The sign-in expired')
					)
				)
			},
			Effect.mapError(cause => AuthError.make({cause, message: 'The sign-in expired or began in another browser'}))
		),
		seal: Effect.fnUntraced(function* (state: GitHubOAuthState, flow: SignInParams, verifier: string) {
			const nonce = yield* random.randomBytes(NONCE)
			const sealed = yield* aead.encrypt(
				key,
				new TextEncoder().encode(
					yield* Schema.encodeEffect(PendingSignInJson)({
						...flow,
						expires: DateTime.add(yield* DateTime.now, {minutes: 10}),
						verifier
					})
				),
				{aad: new TextEncoder().encode(state), nonce}
			)
			return Base64Url.encode(Uint8Array.from([...nonce, ...sealed]))
		})
	}
})
