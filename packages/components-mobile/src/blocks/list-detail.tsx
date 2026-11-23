import {Boolean, Function} from 'effect'

import {ArrangementView, Group, NavigationSplitView, NavigationStack} from '@expo/ui/swift-ui'
import type {NavigationSplitViewVisibility} from '@expo/ui/swift-ui'
import {
	arrangementViewStyle,
	createModifier,
	onGeometryChange,
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
	// Both columns from the start, even when the app opens already wide; the sidebar button still hides the list.
	const [columns, setColumns] = useState<NavigationSplitViewVisibility>('all')
	// The list's width tells whether the split view put it beside the item, as on the unfolded phone in landscape: at most about half the window there, and in a stack the whole window less the outer screen's sensor inset.
	const [listWidth, setListWidth] = useState(Infinity)
	const portrait = window.height > window.width
	const wide = listWidth < window.width * 0.7
	const laptop = portrait && hinge === 'partiallyOpen' && props.opened
	return (
		<BesideContext value={(wide && columns !== 'detailOnly') || laptop}>
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
							// A stack reports its one column; the list comes back beside the item once the window is wide again.
							if (wide) setColumns(visibility)
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
							<Group modifiers={[onGeometryChange(frame => setListWidth(frame.width))]}>{props.list}</Group>
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
