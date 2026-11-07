import {Array, Boolean, Cause, Match, Option, Predicate, Schema, String, pipe} from 'effect'

import type {ClassValue} from 'clsx'
import {clsx} from 'clsx'
import {twMerge} from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs))
}

type JsonError = typeof JsonError.Type
const JsonError = Schema.fromJsonString(Schema.Unknown)

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
			Array.map(error =>
				Boolean.match(String.isNonEmpty(error.message), {onFalse: () => error.name, onTrue: () => error.message})
			),
			Array.join('\n')
		)
	),
	Match.when(Predicate.hasProperty('message'), error => String.String(error.message)),
	Match.when(Predicate.isString, value => String.String(value)),
	Match.when(Predicate.isNullish, () => 'Error' as const),
	Match.when(Predicate.isObjectOrArray, error =>
		Option.getOrElse(Schema.encodeUnknownOption(JsonError)(error), () => 'Unknown Error')
	),
	Match.orElse(() => 'Unknown Error' as const)
)
