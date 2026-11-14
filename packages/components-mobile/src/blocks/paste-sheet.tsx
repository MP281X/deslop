import {useAtomMount, useAtomSet} from '@effect/atom-react'

import {Function, Option} from 'effect'

import {Alert, Button} from '@expo/ui/swift-ui'
import {useMachineResult} from '@typeonce/effect-machine-react'
import {AtomMachine} from '@typeonce/effect-machine/reactivity'
import {AsyncResult} from 'effect/reactivity'
import type {ReactNode} from 'react'

import type {Clipboard} from '#lib/clipboard.ts'

// The one clipboard question every list wraps itself in; the app's labels decide its wording. A system alert asks it over the wrapped screen; a confirmation popover would point away from it.
export function PasteSheet(props: {children: ReactNode; clipboard: Clipboard}) {
	useAtomMount(props.clipboard.returnsAtom)
	const offer = AsyncResult.getOrElse(
		useMachineResult(AtomMachine.select(props.clipboard.atom, 'Offered')),
		Option.none
	)
	const send = useAtomSet(props.clipboard.atom.send)
	return (
		<Alert
			title={
				props.clipboard.labels.questions[
					Option.match(offer, {onNone: Function.constant('link' as const), onSome: open => open.kind})
				]
			}
			isPresented={Option.isSome(offer)}
			onIsPresentedChange={presented => {
				if (!presented) send(props.clipboard.events.Answered({save: false}))
			}}
		>
			<Alert.Trigger>{props.children}</Alert.Trigger>
			<Alert.Actions>
				<Button label="Not Now" role="cancel" onPress={() => send(props.clipboard.events.Answered({save: false}))} />
				<Button
					label={props.clipboard.labels.confirm}
					onPress={() => send(props.clipboard.events.Answered({save: true}))}
				/>
			</Alert.Actions>
		</Alert>
	)
}
