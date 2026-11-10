import {useAtomMount, useAtomSet} from '@effect/atom-react'

import {Option, pipe} from 'effect'

import {useMachineResult} from '@typeonce/effect-machine-react'
import {AtomMachine} from '@typeonce/effect-machine/reactivity'
import {AsyncResult} from 'effect/reactivity'
import type {ReactNode} from 'react'

import {ClipboardDialog} from '#components/clipboard-dialog.tsx'
import type {Clipboard} from '#lib/clipboard.ts'

// The one clipboard question every list wraps itself in; the app's labels decide its wording.
export function PasteSheet(props: {children: ReactNode; clipboard: Clipboard}) {
	useAtomMount(props.clipboard.returnsAtom)
	const offer = pipe(
		useMachineResult(AtomMachine.select(props.clipboard.atom, 'Offered')),
		AsyncResult.getOrElse(Option.none)
	)
	const send = useAtomSet(props.clipboard.atom.send)
	const kind = Option.match(offer, {onNone: () => 'link' as const, onSome: open => open.kind})
	return (
		<ClipboardDialog
			confirm={props.clipboard.labels.confirm}
			onAnswer={save => send({_tag: 'Answered', save})}
			open={Option.isSome(offer)}
			question={props.clipboard.labels.questions[kind]}
		>
			{props.children}
		</ClipboardDialog>
	)
}
