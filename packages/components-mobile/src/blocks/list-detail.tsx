import {Boolean, Function, Option} from 'effect'

import {ArrangementView, NavigationSplitView, NavigationStack, useNativeState} from '@expo/ui/swift-ui'
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
import {Dimensions} from 'react-native'

const ListContext = createContext({
	beside: false,
	choose: Function.constVoid,
	search: Option.none<ReturnType<typeof useNativeState<string>>>(),
	searchFocus: Option.none<{focused: boolean; onChange: (focused: boolean) => void}>(),
	show: Option.none<() => void>()
})

// Whether the list is on screen beside or below the opened item, so the wide window can fill the item's side while nothing is opened.
export function useListBeside() {
	return useContext(ListContext).beside
}

// Puts the list beside or below the opened item, even if the person hid it, so a choice made in the item, such as a tag, shows its result and leaves the item open; none in a stack, where only closing the item shows the list.
export function useListShow() {
	return useContext(ListContext).show
}

// The search text every copy of the list shares, so the copy below an item in laptop posture shows, and clears, the query that filters both; none outside a `ListDetail`.
export function useListSearch() {
	return useContext(ListContext).search
}

// Whether the list's search field has focus, both ways; only the copy below an item in laptop posture has it.
export function useListSearchFocus() {
	return useContext(ListContext).searchFocus
}

// Tells the layout the person chose an item from the list: the field searching the copy below an item in laptop posture lets go of the keyboard and keeps its query, so the chosen item shows above the results.
export function useListChoose() {
	return useContext(ListContext).choose
}

// Columns tile in a landscape window on the inner screen, flat or half open like a book; the outer screen, 466 points across, stacks them in either orientation. The window tells them apart: unfolding reports the hinge open while the window is still the outer screen's.
function tiledIn(window: {height: number; width: number}) {
	return window.width >= window.height && window.height > 466
}

// The item `onHide` opened to keep on screen beside the hidden list, not one the person chose, which closes once the list shows again unless the person chooses it meanwhile.
function useKept(props: {onClose: () => void; onHide?: () => void; opened: boolean}) {
	const [kept, setKept] = useState(false)
	if (!props.opened && kept) setKept(false)
	return {
		choose: () => {
			setKept(false)
		},
		hide: () => {
			if (props.opened) return
			setKept(true)
			props.onHide?.()
		},
		show: () => {
			if (kept) props.onClose()
		}
	}
}

// Half open upright with an item opened, like a laptop, and whether the search field of the list's copy below the item has focus, which the copy, leaving with the posture, never reports lost.
function useLaptop(props: {opened: boolean; portrait: boolean}) {
	const [hinge, setHinge] = useState<HingeStatus>('closed')
	const [searching, setSearching] = useState(false)
	const active = props.portrait && hinge === 'partiallyOpen' && props.opened
	if (!active && searching) setSearching(false)
	return {active, searching, setHinge, setSearching}
}

// The list's copy below the opened item in laptop posture, the one copy whose search field's focus the layout follows and ends.
function ListBelow(props: {list: ReactNode; searching: boolean; onSearchFocus: (focused: boolean) => void}) {
	return (
		<ListContext
			value={{
				...useContext(ListContext),
				searchFocus: Option.some({focused: props.searching, onChange: props.onSearchFocus})
			}}
		>
			<NavigationStack>{props.list}</NavigationStack>
		</ListContext>
	)
}

// An app's one root on the iPhone Duo: list and opened item side by side when the window is wide, as when unfolded like a book; a stack when it is narrow, folded or turned upright; the item above the list when half open like a laptop. The same views stay mounted through every fold and turn, so a draft, its focus and a reading place survive. `detail` is the opened item, or what the wide window shows beside the list when nothing is opened; `onHide` opens that when the person hides the list beside it, so it stays on screen and in front through a fold, and `onClose` closes it once the list shows again, unless the person chose it meanwhile with `useListShow`.
export function ListDetail(props: {
	detail: ReactNode
	list: ReactNode
	modifiers?: ViewModifier[]
	onClose: () => void
	onHide?: () => void
	opened: boolean
}) {
	// The window as of SwiftUI's last layout. React Native's window event arrives while the app is still taking the new size, and a render then can leave the whole app at the previous window's size, text running off the screen; SwiftUI reports a new geometry only once the app has it.
	const [window, setWindow] = useState(() => Dimensions.get('window'))
	// The person's choice from the sidebar button, both columns until they hide the list, kept apart from the one column a stack reports, so the list comes back beside the item once the window is wide again.
	const [chosen, setChosen] = useState<NavigationSplitViewVisibility>('all')
	const [stacked, setStacked] = useState<NavigationSplitViewVisibility>('all')
	// The list hides only beside an opened item: closing it, by Back in a stack, a delete or a saved draft, brings the list back, so a wide window never shows a hidden list beside nothing.
	if (!props.opened && chosen === 'detailOnly') setChosen('all')
	const kept = useKept(props)
	const portrait = window.height > window.width
	const tiled = tiledIn(window)
	const columns = Boolean.match(tiled, {onFalse: Function.constant(stacked), onTrue: Function.constant(chosen)})
	const laptop = useLaptop({opened: props.opened, portrait})
	return (
		<ListContext
			value={{
				beside: (tiled && columns !== 'detailOnly') || laptop.active,
				choose: () => {
					kept.choose()
					laptop.setSearching(false)
				},
				search: Option.some(useNativeState('')),
				searchFocus: Option.none(),
				show: Boolean.match(tiled || laptop.active, {
					onFalse: Option.none,
					onTrue: () =>
						Option.some(() => {
							kept.choose()
							setChosen('all')
						})
				})
			}}
		>
			<ArrangementView
				modifiers={[
					...(props.modifiers ?? []),
					// Flat, the split view covers the copy of the list; half open upright, the copy stands below it. A book's fold is the split view's own seam.
					arrangementViewStyle('overlay', {axes: 'vertical'}),
					onHingeChange((_, context) => laptop.setHinge(context.hinge?.status ?? 'closed')),
					onGeometryChange(() => setWindow(Dimensions.get('window')))
				]}
			>
				<ArrangementView.Primary>
					<NavigationSplitView
						columnVisibility={columns}
						onColumnVisibilityChange={visibility => {
							// The split view reports a stack's one column while it lays out a new window, before SwiftUI's geometry renders this again, so the report belongs to the window as it is now.
							if (!tiledIn(Dimensions.get('window'))) {
								setStacked(visibility)
								return
							}
							setChosen(visibility)
							Boolean.match(visibility === 'detailOnly', {onFalse: kept.show, onTrue: kept.hide})
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
							overlayArrangementEdge('top'),
							// ios/DeslopComponentsModule.swift: the keyboard leaves the arrangement the upper half alone, where it lays the copy of the list under the split view, sized to fit above the keyboard; while the copy's field has focus the split view stands clear, so the field and its results show and answer.
							createModifier('seeThrough', {through: laptop.searching})
						]}
					>
						<NavigationSplitView.Sidebar>{props.list}</NavigationSplitView.Sidebar>
						<NavigationSplitView.Detail>{props.detail}</NavigationSplitView.Detail>
					</NavigationSplitView>
				</ArrangementView.Primary>
				<ArrangementView.Secondary>
					{laptop.active && (
						<ListBelow list={props.list} searching={laptop.searching} onSearchFocus={laptop.setSearching} />
					)}
				</ArrangementView.Secondary>
			</ArrangementView>
		</ListContext>
	)
}
