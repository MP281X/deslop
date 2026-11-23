import {Boolean, Function} from 'effect'

import {ArrangementView, NavigationSplitView, NavigationStack} from '@expo/ui/swift-ui'
import type {NavigationSplitViewVisibility} from '@expo/ui/swift-ui'
import {
	arrangementViewStyle,
	createModifier,
	onHingeChange,
	overlayArrangementEdge
} from '@expo/ui/swift-ui/modifiers'
import type {HingeStatus, ViewModifier} from '@expo/ui/swift-ui/modifiers'
import {createContext, useContext, useState} from 'react'
import type {ReactNode} from 'react'
import {useWindowDimensions} from 'react-native'

const BesideContext = createContext(false)

// Whether the list is on screen beside or below the opened item, so a choice made in the item, such as a tag, can leave it open.
export function useListBeside() {
	return useContext(BesideContext)
}

// An app's one root on the iPhone Duo: list and opened item side by side when the window is wide, as when unfolded like a book; a stack when it is narrow, folded or turned upright; the item above the list when half open like a laptop. The same views stay mounted through every fold and turn, so a draft, its focus and a reading place survive. `detail` is the opened item, or what the wide window shows beside the list when nothing is opened.
export function ListDetail(props: {
	detail: ReactNode
	list: ReactNode
	modifiers?: ViewModifier[]
	onClose: () => void
	opened: boolean
}) {
	const window = useWindowDimensions()
	const [hinge, setHinge] = useState<HingeStatus>('closed')
	// The person's choice from the sidebar button, both columns until they hide the list, kept apart from the one column a stack reports, so the list comes back beside the item once the window is wide again.
	const [chosen, setChosen] = useState<NavigationSplitViewVisibility>('all')
	const [stacked, setStacked] = useState<NavigationSplitViewVisibility>('all')
	const portrait = window.height > window.width
	// Columns tile in a landscape window on the inner screen, flat or half open like a book; the outer screen stacks them in either orientation. The split view reports a stack's one column after the window has changed, so this is already current then.
	const tiled = !portrait && hinge !== 'closed'
	const columns = Boolean.match(tiled, {onFalse: Function.constant(stacked), onTrue: Function.constant(chosen)})
	const laptop = portrait && hinge === 'partiallyOpen' && props.opened
	return (
		<BesideContext value={(tiled && columns !== 'detailOnly') || laptop}>
			<ArrangementView
				modifiers={[
					...(props.modifiers ?? []),
					// Flat, the split view covers the copy of the list; half open upright, the copy stands below it. A book's fold is the split view's own seam.
					arrangementViewStyle('overlay', {axes: 'vertical'}),
					onHingeChange((_, context) => setHinge(context.hinge?.status ?? 'closed'))
				]}
			>
				<ArrangementView.Primary>
					<NavigationSplitView
						columnVisibility={columns}
						onColumnVisibilityChange={visibility => {
							if (tiled) setChosen(visibility)
							else setStacked(visibility)
						}}
						preferredCompactColumn={Boolean.match(props.opened, {
							onFalse: Function.constant('sidebar'),
							onTrue: Function.constant('detail')
						})}
						onPreferredCompactColumnChange={column => {
							if (column === 'sidebar') props.onClose()
						}}
						modifiers={[
							// ios/DeslopComponentsModule.swift: a compact width, so the split view stacks its columns in a portrait window.
							createModifier('stackedColumns', {stacked: portrait}),
							overlayArrangementEdge('top')
						]}
					>
						<NavigationSplitView.Sidebar>
							{props.list}
						</NavigationSplitView.Sidebar>
						<NavigationSplitView.Detail>{props.detail}</NavigationSplitView.Detail>
					</NavigationSplitView>
				</ArrangementView.Primary>
				<ArrangementView.Secondary>
					{laptop && <NavigationStack>{props.list}</NavigationStack>}
				</ArrangementView.Secondary>
			</ArrangementView>
		</BesideContext>
	)
}
