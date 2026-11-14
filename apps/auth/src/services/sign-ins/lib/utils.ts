import {Array, Duration, Function, Option, String, pipe} from 'effect'

import {SignInCode} from '#services/sign-ins/schema.ts'

// A sign-in's code is its id, in RFC 8628's user-code letters: no vowels and no letters that read alike.
const CODE_LETTERS = 'BCDFGHJKLMNPQRSTVWXZ'

export const CODE_LENGTH = 8

export const SIGN_IN_LIFETIME = Duration.minutes(10)

export function typedCode(text: string) {
	return String.toUpperCase(String.replaceAll(/[^a-z]/giu, '')(text))
}

export function codeFrom(bytes: Uint8Array) {
	return SignInCode.make(
		pipe(
			Array.fromIterable(bytes),
			Array.map(byte =>
				pipe(CODE_LETTERS, String.charAt(byte % CODE_LETTERS.length), Option.getOrElse(Function.constant('')))
			),
			Array.join('')
		)
	)
}
