import {useAtomValue} from '@effect/atom-react'

import {Array, Effect} from 'effect'

import {RoundedRectangle} from '@expo/ui/swift-ui'
import {Animation, animation, foregroundStyle, opacity, redacted} from '@expo/ui/swift-ui/modifiers'
import type {ViewModifier} from '@expo/ui/swift-ui/modifiers'
import {AsyncResult, Atom} from 'effect/reactivity'

import {colors} from '#components/theme.ts'
import {Item, ItemContent, ItemDescription, ItemGroup, ItemTitle, itemRow} from '#components/ui/item.tsx'

// DESIGN.md, Loading: skeletons fade in after 300ms; the atom drops when unread, so each loading restarts the wait.
const lateAtom = Atom.make(Effect.as(Effect.sleep('300 millis'), true))

// The skeleton's opacity: none until loading has taken long enough to show it.
function useLate() {
	if (AsyncResult.isSuccess(useAtomValue(lateAtom))) return 1
	return 0
}

// shadcn's Skeleton on iOS: a muted block the caller sizes with frame, standing in for content that is loading.
export function Skeleton(props: {modifiers?: ViewModifier[]}) {
	const late = useLate()
	return (
		<RoundedRectangle
			cornerRadius={6}
			modifiers={[
				...(props.modifiers ?? []),
				foregroundStyle(colors.card),
				opacity(late),
				animation(Animation.snappy(), late)
			]}
		/>
	)
}

// A list's rows while its data loads, as SwiftUI's own placeholder redaction draws them.
export function ItemGroupSkeleton(props: {rows: number}) {
	const late = useLate()
	return (
		<ItemGroup modifiers={[redacted('placeholder')]}>
			{Array.map(Array.range(1, props.rows), row => (
				<Item key={row} modifiers={[...itemRow, opacity(late), animation(Animation.snappy(), late)]}>
					<ItemContent>
						<ItemTitle>Placeholder row title</ItemTitle>
						<ItemDescription>Placeholder detail line</ItemDescription>
					</ItemContent>
				</Item>
			))}
		</ItemGroup>
	)
}
