import {Option} from 'effect'

import {AsyncResult} from 'effect/reactivity'

import {FieldError} from '#components/ui/field.tsx'

// The message a failed action left, under the control it belongs to; nothing while it has none.
export function ResultError(props: {className?: string; result: AsyncResult.AsyncResult<unknown, {message: string}>}) {
	return (
		<FieldError className={props.className}>
			{Option.getOrUndefined(Option.map(AsyncResult.error(props.result), error => error.message))}
		</FieldError>
	)
}
