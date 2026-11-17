import {Effect} from 'effect'

import {Digest} from 'effect/crypto'
import type {SecureRandom} from 'effect/crypto'
import {Base64Url} from 'effect/encoding'

export function randomTokenOf(random: SecureRandom.SecureRandom['Service']) {
	return (bytes: number) => Effect.map(random.randomBytes(bytes), Base64Url.encode)
}
export function hashOf(digest: Digest.Digest['Service']) {
	return (value: string) => Effect.map(digest.digest(Digest.sha256, new TextEncoder().encode(value)), Base64Url.encode)
}
