import {useAtomRefresh, useAtomValue} from '@effect/atom-react'

import {Boolean, Function, Option} from 'effect'
import type {Cause} from 'effect'

import {Image} from '@expo/ui/swift-ui'
import {accessibilityLabel} from '@expo/ui/swift-ui/modifiers'
import {AsyncResult} from 'effect/reactivity'
import type {Atom} from 'effect/reactivity'
import type {ReactNode} from 'react'

import {blockingFailure, isDeniedCause} from '@deslop/runtime/client/live-stream'

import {Button} from '#components/ui/button.tsx'
import {Empty, EmptyContent, EmptyMedia} from '#components/ui/empty.tsx'

// A blocking failure is one destructive button carrying its reason; a denial is a lock with no retry.
export function FailureContent(props: {cause: Cause.Cause<unknown>; onRetry: () => void}) {
	return (
		<Empty>
			{Boolean.match(isDeniedCause(props.cause), {
				onFalse: () => (
					<EmptyContent>
						<Button variant="destructive" size="lg" systemImage="arrow.clockwise" onPress={props.onRetry}>
							Can’t Load This View
						</Button>
					</EmptyContent>
				),
				onTrue: () => (
					<EmptyMedia>
						<Image systemName="lock" modifiers={[accessibilityLabel('Access denied')]} />
					</EmptyMedia>
				)
			})}
		</Empty>
	)
}

// One gate for a screen's content: the fallback while nothing has arrived, a blocking failure as the retry card, and the value where it stands.
export function Loaded<A, E>(props: {
	atom: Atom.Atom<AsyncResult.AsyncResult<A, E>>
	children: (value: A) => ReactNode
	fallback: ReactNode
}) {
	const loaded = useAtomValue(props.atom)
	const refresh = useAtomRefresh(props.atom)
	if (AsyncResult.isInitial(loaded)) {
		return props.fallback
	}
	return Option.match(blockingFailure(loaded), {
		onNone: () => Option.match(AsyncResult.value(loaded), {onNone: Function.constNull, onSome: props.children}),
		onSome: cause => <FailureContent cause={cause} onRetry={refresh} />
	})
}
