import {Option} from 'effect'

import {AsyncResult} from 'effect/reactivity'

import {FieldError} from '#components/ui/field.tsx'

export function ResultError(props: {result: AsyncResult.AsyncResult<unknown, {message: string}>}) {
	return (
		<FieldError>
			{Option.getOrUndefined(Option.map(AsyncResult.error(props.result), error => error.message))}
		</FieldError>
	)
}
