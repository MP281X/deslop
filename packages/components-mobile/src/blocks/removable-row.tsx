import {useAtomSet} from '@effect/atom-react'

import {Struct} from 'effect'

import {Button as NativeButton, ContextMenu, SwipeActions} from '@expo/ui/swift-ui'
import {accessibilityAddTraits} from '@expo/ui/swift-ui/modifiers'
import type {ViewModifier} from '@expo/ui/swift-ui/modifiers'
import {MachineState} from '@typeonce/effect-machine-react'
import type {ReactNode} from 'react'

import {useListChoose} from '#components/blocks/list-detail.tsx'
import {Button} from '#components/ui/button.tsx'
import {Item, ItemActions, itemRow} from '#components/ui/item.tsx'
import type {ItemAlignment} from '#components/ui/item.tsx'
import type {Removal} from '#lib/removal.ts'

// The destructive role is the whole style: red in a menu and as a swipe action.
function DeleteAction(props: {onPress: () => void}) {
	return <NativeButton label="Delete" systemImage="trash" role="destructive" onPress={props.onPress} />
}

// A list row that can be removed: swipe or long-press Delete, then the row waits muted with Undo until the removal goes through. `children` draws the row, `pending` while it waits; `menu` adds long-press actions before Delete.
export function RemovableRow<Id extends string>(props: {
	alignment?: ItemAlignment
	children: (pending: boolean) => ReactNode
	id: Id
	menu?: ReactNode
	modifiers?: ViewModifier[]
	onOpen: () => void
	removal: Removal<Id>
}) {
	const machine = props.removal.machine(props.id)
	const remove = useAtomSet(props.removal.removeAtom)
	const send = useAtomSet(machine.send)
	const choose = useListChoose()
	return (
		<>
			<MachineState machine={machine} path="Idle">
				{() => (
					<SwipeActions modifiers={[...itemRow, ...(props.modifiers ?? [])]}>
						<ContextMenu>
							<ContextMenu.Trigger>
								<Item
									{...Struct.pick(props, ['alignment'])}
									onPress={() => {
										choose()
										props.onOpen()
									}}
									modifiers={[accessibilityAddTraits(['isButton'])]}
								>
									{props.children(false)}
								</Item>
							</ContextMenu.Trigger>
							<ContextMenu.Items>
								{props.menu}
								<DeleteAction onPress={() => remove(props.id)} />
							</ContextMenu.Items>
						</ContextMenu>
						<SwipeActions.Actions edge="trailing">
							<DeleteAction onPress={() => remove(props.id)} />
						</SwipeActions.Actions>
					</SwipeActions>
				)}
			</MachineState>
			<MachineState machine={machine} path="Pending">
				{() => (
					<Item {...Struct.pick(props, ['alignment'])} modifiers={itemRow}>
						{props.children(true)}
						<ItemActions>
							<Button
								variant="ghost"
								size="icon"
								systemImage="arrow.uturn.backward"
								onPress={() => send(props.removal.events.Restored())}
							>
								Undo
							</Button>
						</ItemActions>
					</Item>
				)}
			</MachineState>
		</>
	)
}
