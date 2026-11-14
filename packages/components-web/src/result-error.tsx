import {Function, Option} from 'effect'

import {AsyncResult} from 'effect/reactivity'

import {FieldError} from '#components/ui/field.tsx'
import {ItemFooter} from '#components/ui/item.tsx'

export function ResultError(props: {result: AsyncResult.AsyncResult<unknown, {message: string}>}) {
	return (
		<FieldError>
			{Option.getOrUndefined(Option.map(AsyncResult.error(props.result), error => error.message))}
		</FieldError>
	)
}

// A row's failed action, on its own line at the bottom of the row's Item.
export function ItemResultError(props: {result: AsyncResult.AsyncResult<unknown, {message: string}>}) {
	return Option.match(AsyncResult.error(props.result), {
		onNone: Function.constNull,
		onSome: error => (
			<ItemFooter>
				<FieldError>{error.message}</FieldError>
			</ItemFooter>
		)
	})
}
