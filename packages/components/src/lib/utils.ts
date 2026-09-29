import {Array, Cause, Match, Predicate, Schema, String, pipe} from 'effect'

import type {ClassValue} from 'clsx'
import {clsx} from 'clsx'
import {twMerge} from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs))
}

export const formatError = pipe(
	Match.type(),
	Match.when(Predicate.isError, error => {
		if (String.isEmpty(error.message) || error.message === 'Error') return error.name
		return error.message
	}),
	Match.when(Cause.isCause, cause =>
		pipe(
			cause,
			Cause.prettyErrors,
			Array.map(error => (String.isNonEmpty(error.message) ? error.message : error.name)),
			Array.join('\n')
		)
	),
	Match.when(Predicate.hasProperty('message'), error => String.String(error.message)),
	Match.when(Predicate.isString, value => String.String(value)),
	Match.when(Predicate.isNullish, () => 'Error' as const),
	Match.when(Predicate.isObjectOrArray, error =>
		Schema.encodeUnknownSync(Schema.fromJsonString(Schema.Unknown))(error)
	),
	Match.orElse(() => 'Unknown Error' as const)
)

export function toSentenceCase(value: string) {
	return pipe(
		value,
		String.replaceAll(/[-_]+/gu, ' '),
		String.replaceAll(/([a-z0-9])([A-Z])/gu, '$1 $2'),
		String.trim,
		String.toLowerCase,
		String.capitalize
	)
}
