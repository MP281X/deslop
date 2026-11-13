import {useAtom} from '@effect/atom-react'

import {Boolean, Effect, Schema} from 'effect'

import {CheckIcon, CopyIcon} from '@phosphor-icons/react'
import {AsyncResult, Atom} from 'effect/reactivity'
import type {ReactNode} from 'react'

import {Button} from '#components/ui/button.tsx'
import {cn} from '#lib/classes.ts'

class ClipboardError extends Schema.TaggedError<ClipboardError>()('ClipboardError', {cause: Schema.Defect()}) {}

// The copy stays waiting for a moment after it lands, which the button shows as its check; a press inside that moment starts over.
const copyAtom = Atom.family((value: string) =>
	Atom.fn(() =>
		Effect.andThen(
			Effect.tryPromise({
				catch: cause => ClipboardError.make({cause}),
				try: () => navigator.clipboard.writeText(value)
			}),
			Effect.sleep('1500 millis')
		)
	)
)

// Copies a value in place: a plain check for a moment after, and a destructive button while the clipboard refuses.
export function CopyButton(props: {
	children?: ReactNode
	className?: string
	label: string
	size?: 'default' | 'icon-sm'
	value: string
}) {
	const [result, copy] = useAtom(copyAtom(props.value))
	const copied = AsyncResult.isWaiting(result)
	const failed = AsyncResult.isFailure(result) && !copied
	return (
		<Button
			variant={Boolean.match(failed, {onFalse: () => 'ghost' as const, onTrue: () => 'destructive' as const})}
			size={props.size}
			className={props.className}
			aria-label={props.label}
			title={Boolean.match(failed, {onFalse: () => undefined, onTrue: () => 'Cannot copy'})}
			onClick={() => copy()}
		>
			{props.children}
			{Boolean.match(copied, {
				onFalse: () => <CopyIcon className={cn(props.children !== undefined && 'text-muted-foreground')} />,
				onTrue: () => <CheckIcon />
			})}
			<span role="status" className="sr-only">
				{copied && 'Copied'}
				{failed && 'Cannot copy'}
			</span>
		</Button>
	)
}
