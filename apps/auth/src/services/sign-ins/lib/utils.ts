import {Array, Duration, Option, String, pipe} from 'effect'

// A sign-in's code is its id, in RFC 8628's user-code letters: no vowels and no letters that read alike.
const CODE_LETTERS = 'BCDFGHJKLMNPQRSTVWXZ'

export const CODE_LENGTH = 8

export const SIGN_IN_LIFETIME = Duration.fromInputUnsafe('10 minutes')

export function typedCode(text: string) {
	return String.toUpperCase(String.replaceAll(/[^a-z]/giu, '')(text))
}

export function codeFrom(bytes: Uint8Array) {
	return pipe(
		Array.fromIterable(bytes),
		Array.map(byte =>
			pipe(
				CODE_LETTERS,
				String.charAt(byte % CODE_LETTERS.length),
				Option.getOrElse(() => '')
			)
		),
		Array.join('')
	)
}
