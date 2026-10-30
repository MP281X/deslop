import {Array, Option, String, pipe} from 'effect'

// A sign-in's code is its id, in RFC 8628's user-code letters: no vowels and no letters that read alike.
const CODE_LETTERS = 'BCDFGHJKLMNPQRSTVWXZ'

export const CODE_LENGTH = 8

// What someone typed, as the code it names: letters only, in capitals.
export function typedCode(text: string) {
	return String.toUpperCase(String.replaceAll(/[^a-z]/giu, '')(text))
}

export function codeFrom(bytes: Uint8Array) {
	return Array.join(
		Array.map(Array.fromIterable(bytes), byte =>
			pipe(
				CODE_LETTERS,
				String.charAt(byte % CODE_LETTERS.length),
				Option.getOrElse(() => '')
			)
		),
		''
	)
}
