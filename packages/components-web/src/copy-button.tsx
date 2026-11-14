import {useAtom} from '@effect/atom-react'

import {Boolean, Effect, Function, Schema, Stream} from 'effect'

import {CheckIcon, CopyIcon} from '@phosphor-icons/react'
import {AsyncResult, Atom} from 'effect/reactivity'
import type {ReactNode} from 'react'

import {Button} from '#components/ui/button.tsx'
import {FieldError} from '#components/ui/field.tsx'
import {cn} from '#lib/classes.ts'

class ClipboardError extends Schema.TaggedError<ClipboardError>()('ClipboardError', {cause: Schema.Defect()}) {}

export type CopyButtonSize = typeof CopyButtonSize.Type
const CopyButtonSize = Schema.Literals(['default', 'icon-sm'])

// Each press first clears an earlier check, is true once the clipboard took the value, and false again after the check's moment.
const copyAtom = Atom.family((value: string) =>
	Atom.fn(() =>
		Stream.concat(
			Stream.succeed(false),
			Stream.concat(
				Stream.fromEffect(
					Effect.as(
						Effect.tryPromise({
							catch: cause => ClipboardError.make({cause}),
							try: () => navigator.clipboard.writeText(value)
						}),
						true
					)
				),
				Stream.fromEffect(Effect.as(Effect.sleep('1500 millis'), false))
			)
		)
	)
)

// Copies a value in place with a plain check once it landed. A refusal shows the caller's sentence under the button, or without one turns the button destructive.
export function CopyButton(props: {
	children?: ReactNode
	className?: string
	failure?: string
	label: string
	size?: CopyButtonSize
	value: string
}) {
	const [result, copy] = useAtom(copyAtom(props.value))
	const copied = AsyncResult.isSuccess(result) && result.value
	// A retry in flight is no longer the failure it follows.
	const failed = AsyncResult.isFailure(result) && !result.waiting
	const explained = failed && props.failure !== undefined
	return (
		<>
			<Button
				variant={Boolean.match(failed && !explained, {
					onFalse: () => 'ghost' as const,
					onTrue: () => 'destructive' as const
				})}
				size={props.size}
				className={props.className}
				aria-label={props.label}
				title={Boolean.match(failed && !explained, {onFalse: Function.constUndefined, onTrue: () => 'Cannot copy'})}
				onClick={() => copy()}
			>
				{props.children}
				{Boolean.match(copied, {
					onFalse: () => <CopyIcon className={cn(props.children !== undefined && 'text-muted-foreground')} />,
					onTrue: () => <CheckIcon />
				})}
				<span role="status" className="sr-only">
					{copied && 'Copied'}
					{failed && !explained && 'Cannot copy'}
				</span>
			</Button>
			{explained && <FieldError>{props.failure}</FieldError>}
		</>
	)
}
