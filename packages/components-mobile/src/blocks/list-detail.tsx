import {Boolean, Function, Option} from 'effect'

import {ArrangementView, Group, NavigationSplitView, NavigationStack, useNativeState} from '@expo/ui/swift-ui'
import type {NavigationSplitViewVisibility} from '@expo/ui/swift-ui'
import {
	arrangementViewStyle,
	createModifier,
	onGeometryChange,
	onHingeChange,
	overlayArrangementEdge
} from '@expo/ui/swift-ui/modifiers'
import type {HingeStatus, ViewModifier} from '@expo/ui/swift-ui/modifiers'
import {createContext, isValidElement, useContext, useState} from 'react'
import type {ReactNode} from 'react'
import {Dimensions} from 'react-native'

const ListContext = createContext({
	beside: false,
	choose: Function.constVoid,
	search: Option.none<ReturnType<typeof useNativeState<string>>>(),
	searchFocus: Option.none<{focused: boolean; onChange: (focused: boolean) => void}>(),
	show: Option.none<() => void>(),
	tiled: false
})

function columnsFor(props: {alone?: boolean; opened: boolean}) {
	return Boolean.match(props.opened && props.alone === true, {
		onFalse: Function.constant<NavigationSplitViewVisibility>('all'),
		onTrue: Function.constant<NavigationSplitViewVisibility>('detailOnly')
	})
}

// The person's choice from the sidebar button, both columns until they hide the list unless the item opens alone. An item opened alone takes the whole window again when it or another one opens, told apart by the detail's key, and after a fold or a turn.
function useChosen(props: {alone?: boolean; detail: ReactNode; opened: boolean}, width: number) {
	const [chosen, setChosen] = useState(() => columnsFor(props))
	const shown = {item: isValidElement(props.detail) && props.detail.key, opened: props.opened, width}
	const [seen, setSeen] = useState(shown)
	if (shown.opened !== seen.opened || shown.item !== seen.item || shown.width !== seen.width) {
		setSeen(shown)
		if (props.alone === true) setChosen(columnsFor(props))
	}
	return [chosen, setChosen] as const
}

// Whether the list is on screen beside or below the opened item, so the wide window can fill the item's side while nothing is opened.
export function useListBeside() {
	return useContext(ListContext).beside
}

// Puts the list beside or below the opened item, even if the person hid it, so a choice made in the item, such as a tag, shows its result and leaves the item open; none in a stack, where only closing the item shows the list.
export function useListShow() {
	return useContext(ListContext).show
}

// Whether list and item tile side by side, where the split view draws no Back on the item, so an item that replaced what stands there with nothing opened, such as a board, offers its own close.
export function useListTiled() {
	return useContext(ListContext).tiled
}

// The search text every copy of the list shares, so the copy below an item in laptop posture shows, and clears, the query that filters both; none outside a `ListDetail`.
export function useListSearch() {
	return useContext(ListContext).search
}

// Whether the list's search field has focus, both ways: the split view's copy and the copy below an item in laptop posture each have their own; none outside a `ListDetail`.
export function useListSearchFocus() {
	return useContext(ListContext).searchFocus
}

// Tells the layout the person chose an item from the list: the field searching either copy lets go of the keyboard and keeps its query, so the chosen item shows above the results, or beside them in a book with its end clear of the keyboard.
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

// Half open upright with an item opened or a board, like a laptop, and whether the search field of the list's copy below the item has focus, which leaving the posture ends, so the keyboard leaves with the copy; and whether the split view's copy's field has focus. Choosing an item ends both.
function useLaptop(props: {above: boolean; portrait: boolean}) {
	const [hinge, setHinge] = useState<HingeStatus>('closed')
	const [searching, setSearching] = useState(false)
	const [splitSearching, setSplitSearching] = useState(false)
	const active = props.portrait && hinge === 'partiallyOpen' && props.above
	if (!active && searching) setSearching(false)
	return {
		active,
		choose: () => {
			setSearching(false)
			setSplitSearching(false)
		},
		searching,
		setHinge,
		setSearching,
		splitSearch: Option.some({focused: splitSearching, onChange: setSplitSearching})
	}
}

// The list's copy below the opened item in laptop posture, with its own search field's focus, which the layout follows and leaving the posture ends. It stays mounted while an item is opened or a board stands above it, under the split view and out of reach in every other posture, so unfolding and half opening again finds the list where the person left it.
function ListBelow(props: {
	below: boolean
	list: ReactNode
	searching: boolean
	onSearchFocus: (focused: boolean) => void
}) {
	return (
		<ListContext
			value={{
				...useContext(ListContext),
				searchFocus: Option.some({focused: props.searching, onChange: props.onSearchFocus})
			}}
		>
			<NavigationStack modifiers={[createModifier('seeThrough', {through: !props.below})]}>
				{props.list}
			</NavigationStack>
		</ListContext>
	)
}

// The person's choice of columns, kept apart from the one column a stack reports, so the list comes back beside the item once the window is wide again.
function useColumns(
	props: {
		alone?: boolean
		board?: boolean
		detail: ReactNode
		onClose: () => void
		onHide?: () => void
		opened: boolean
	},
	window: {height: number; width: number}
) {
	const [chosen, setChosen] = useChosen(props, window.width)
	const [stacked, setStacked] = useState<NavigationSplitViewVisibility>('all')
	// The list hides only beside an opened item or a board: closing the item with no board behind it, by Back in a stack, a delete or a saved draft, brings the list back, so a wide window never shows a hidden list beside nothing. Beside a board the choice holds, also through a fold, which makes a new split view that shows it.
	if (!props.opened && props.board !== true && chosen === 'detailOnly') setChosen('all')
	const kept = useKept(props)
	return {
		choose: kept.choose,
		// Whether anything could stand beside the hidden list: an opened item, a board or what `onHide` opens. Hiding it beside nothing would leave the window blank, and the split view hides it before reporting, so setting the columns back to both, the value it already holds, would never reach it.
		hidable: props.opened || props.board === true || props.onHide !== undefined,
		onChange: (visibility: NavigationSplitViewVisibility) => {
			// The split view reports a stack's one column while it lays out a new window, before SwiftUI's geometry renders this again, so the report belongs to the window as it is now.
			if (!tiledIn(Dimensions.get('window'))) {
				setStacked(visibility)
				return
			}
			setChosen(visibility)
			Boolean.match(visibility === 'detailOnly', {onFalse: kept.show, onTrue: kept.hide})
		},
		show: () => {
			kept.choose()
			setChosen('all')
		},
		visibility: Boolean.match(tiledIn(window), {onFalse: Function.constant(stacked), onTrue: Function.constant(chosen)})
	}
}

// An app's one root on the iPhone Duo: list and opened item side by side when the window is wide, as when unfolded like a book; a stack when it is narrow, folded or turned upright; the item above the list when half open like a laptop. The same views stay mounted through every fold and turn, so a draft, its focus and a reading place survive. `detail` is the opened item, or what the wide window shows beside the list when nothing is opened; with `board`, that also stands above the list when half open. `onHide` opens that when the person hides the list beside it, so it stays on screen and in front through a fold, and `onClose` closes it once the list shows again, unless the person chose it meanwhile with `useListShow`. An item that opens `alone`, such as a book's spread, takes the whole wide window each time it or another one opens, and the sidebar button brings the list back beside it.
export function ListDetail(props: {
	alone?: boolean
	board?: boolean
	detail: ReactNode
	list: ReactNode
	modifiers?: ViewModifier[]
	onClose: () => void
	onHide?: () => void
	opened: boolean
}) {
	// The window as of SwiftUI's last layout. React Native's window event arrives while the app is still taking the new size, and a render then can leave the whole app at the previous window's size, text running off the screen; SwiftUI reports a new geometry only once the app has it.
	const [window, setWindow] = useState(() => Dimensions.get('window'))
	const columns = useColumns(props, window)
	// A back above the list in laptop posture pops to the list's own column, and the split view reads the unchanged wish for the board only when it is made again: a new split view brings the board back, its list hidden under it until the phone lies flat. One made in a stack reports its one column as the person's choice once the window tiles, so a tiled window always makes its own.
	const [returns, setReturns] = useState(0)
	const portrait = window.height > window.width
	const tiled = tiledIn(window)
	const laptop = useLaptop({above: props.opened || props.board === true, portrait})
	return (
		<ListContext
			value={{
				beside: (tiled && columns.visibility !== 'detailOnly') || laptop.active,
				choose: () => {
					columns.choose()
					laptop.choose()
				},
				search: Option.some(useNativeState('')),
				searchFocus: laptop.splitSearch,
				show: Boolean.match(tiled || laptop.active, {onFalse: Option.none, onTrue: () => Option.some(columns.show)}),
				tiled
			}}
		>
			<ArrangementView
				modifiers={[
					...(props.modifiers ?? []),
					// Flat, the split view covers the copy of the list; half open upright, the copy stands below it. A book's fold is the split view's own seam. Half open upright with nothing above the list, the arrangement still keeps the lower half for the copy, so it may then lay out only across, along the fold, where it never does.
					arrangementViewStyle('overlay', {
						axes: Boolean.match(portrait && !laptop.active, {
							onFalse: Function.constant('vertical'),
							onTrue: Function.constant('horizontal')
						})
					}),
					onHingeChange((_, context) => laptop.setHinge(context.hinge?.status ?? 'closed')),
					onGeometryChange(() => setWindow(Dimensions.get('window')))
				]}
			>
				<ArrangementView.Primary>
					<NavigationSplitView
						key={Boolean.match(tiled, {onFalse: Function.constant(returns), onTrue: Function.constant(0)})}
						columnVisibility={columns.visibility}
						onColumnVisibilityChange={columns.onChange}
						preferredCompactColumn={Boolean.match(props.opened || laptop.active, {
							onFalse: Function.constant('sidebar'),
							onTrue: Function.constant('detail')
						})}
						onPreferredCompactColumnChange={column => {
							if (column !== 'sidebar') return
							props.onClose()
							if (laptop.active && props.board === true) setReturns(count => count + 1)
						}}
						modifiers={[
							// ios/DeslopComponentsModule.swift: a compact width, so the split view stacks its columns in a portrait window.
							createModifier('stackedColumns', {stacked: portrait}),
							overlayArrangementEdge('top'),
							// ios/DeslopComponentsModule.swift: the keyboard leaves the arrangement the upper half alone, where it lays the copy of the list under the split view, sized to fit above the keyboard; while the copy's field has focus the split view stands clear, so the field and its results show and answer.
							createModifier('seeThrough', {through: laptop.searching})
						]}
					>
						<NavigationSplitView.Sidebar>
							{/* ios/DeslopComponentsModule.swift: no sidebar button while the list could hide beside nothing. */}
							<Group modifiers={[createModifier('sidebarToggleHidden', {hidden: !columns.hidable})]}>
								{props.list}
							</Group>
						</NavigationSplitView.Sidebar>
						<NavigationSplitView.Detail>{props.detail}</NavigationSplitView.Detail>
					</NavigationSplitView>
				</ArrangementView.Primary>
				<ArrangementView.Secondary>
					{(props.opened || props.board === true) && (
						<ListBelow
							below={laptop.active}
							list={props.list}
							searching={laptop.searching}
							onSearchFocus={laptop.setSearching}
						/>
					)}
				</ArrangementView.Secondary>
			</ArrangementView>
		</ListContext>
	)
}
