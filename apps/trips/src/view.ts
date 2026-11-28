import {Boolean, Function, Option} from 'effect'

import type {Components} from '@deslop/components/components'
import type {Absent, ListOptions, PaneLeaf, Selection, SheetOptions} from '@deslop/components/model'

import type {TripsScreen} from '#app'

import {boardingSections, flightRowOptions} from '#itinerary/screen.ts'
import type {BoardingPass, FlightRow, Itinerary} from '#itinerary/screen.ts'

export type TripsNotice = {action: Selection['back']; back: boolean; label: string; message: string; pending: boolean}

// The pieces the hosts draw differently: the flights' list and boarding pass, the sheet that takes a booking, the notices and how the page frames them.
export type TripsUi<H, C, S> = Components<H, C, S> & {
	board: (host: H, screen: TripsScreen, pass: BoardingPass) => PaneLeaf<C>
	boardSkeleton: (host: H) => PaneLeaf<C>
	booking: (host: H, screen: TripsScreen) => SheetOptions<C>
	detailGroup: (host: H, title: string, rows: readonly C[]) => C
	detailRows: (host: H, rows: readonly C[]) => C
	flightTime: (host: H, was: string, current?: string) => C
	itineraryRows: (host: H, screen: TripsScreen, list: Itinerary, wide: boolean, id: Selection['id']) => PaneLeaf<C>
	missing: (host: H, text: string) => PaneLeaf<C>
	banner: (host: H, notice: TripsNotice) => PaneLeaf<C>
	// What went wrong with the last thing asked, over the page.
	stage: (host: H, options: ListOptions<C>, report: string | Absent) => S
}

// The page's own word for what the shell found or what failed to load, with the way out.
function noticeOf(screen: TripsScreen) {
	if (screen.problem !== undefined) {
		if (screen.problem.back) {
			return {
				action: screen.selection.back,
				back: true,
				label: 'Back to Trips',
				message: screen.problem.text,
				pending: screen.pending
			} satisfies TripsNotice
		}
		if (screen.problem.signIn) {
			return {
				action: screen.signIn,
				back: false,
				label: 'Continue with GitHub',
				message: 'Sign in with Auth',
				pending: screen.pending
			} satisfies TripsNotice
		}
		return {
			action: screen.reload,
			back: false,
			label: 'Retry',
			message: screen.problem.text,
			pending: screen.pending
		} satisfies TripsNotice
	}
	if (screen.failure === undefined) return undefined
	return {
		action: screen.reload,
		back: false,
		label: 'Retry',
		message: screen.failure,
		pending: screen.pending
	} satisfies TripsNotice
}

export function flightRow<H, C, S>(
	host: H,
	ui: TripsUi<H, C, S>,
	screen: TripsScreen,
	row: FlightRow,
	activeId?: string
) {
	return ui.row(
		host,
		flightRowOptions(row, screen.selection.select, activeId, (was, current) => ui.flightTime(host, was, current))
	)
}

// A boarding pass's rows, then its travellers.
export function boardSections<H, C, S>(host: H, ui: TripsUi<H, C, S>, screen: TripsScreen, pass: BoardingPass) {
	return boardingSections(
		pass,
		row => flightRow(host, ui, screen, row),
		rows => ui.detailRows(host, rows),
		(title, rows) => ui.detailGroup(host, title, rows)
	)
}

export function bookingSheet<C>(
	screen: TripsScreen,
	body: SheetOptions<C>['body'],
	actions: NonNullable<SheetOptions<C>['actions']>
): SheetOptions<C> {
	return {
		actions,
		body,
		dismiss: screen.cancel,
		label: 'Paste booking',
		open: screen.pasteOpen,
		pending: screen.pending
	}
}

export function bookingAction(pending: boolean) {
	return Boolean.match(pending, {onFalse: Function.constant('Add booking'), onTrue: Function.constant('Adding…')})
}

export function Workspace<H, C, S>(host: H, screen: TripsScreen, ui: TripsUi<H, C, S>) {
	const notice = noticeOf(screen)
	function message() {
		return Option.getOrUndefined(Option.map(Option.fromUndefinedOr(notice), banner => ui.banner(host, banner)))
	}
	function detail() {
		if (screen.loading) return ui.boardSkeleton(host)
		if (screen.board !== undefined) return ui.board(host, screen, screen.board)
		if (screen.missing) {
			return ui.missing(
				host,
				Boolean.match(screen.stale, {
					onFalse: Function.constant('Flight not found'),
					onTrue: Function.constant('Flight not loaded')
				})
			)
		}
		if (screen.selection.id !== undefined) return message()
		return undefined
	}
	const opened = detail()
	const empty = message()
	return ui.stage(
		host,
		{
			defaultId: screen.defaultId,
			...(opened !== undefined && {detail: opened}),
			detailToolbar: screen.detailToolbar,
			...(empty !== undefined && {empty}),
			list: Option.getOrUndefined(
				Option.map(
					Option.fromUndefinedOr(screen.itinerary),
					itinerary => (id: Selection['id'], wide: boolean) => ui.itineraryRows(host, screen, itinerary, wide, id)
				)
			),
			loading: screen.loading,
			selection: screen.selection,
			sheet: ui.booking(host, screen),
			toolbar: screen.toolbar
		} satisfies ListOptions<C>,
		Boolean.match(screen.pasteOpen, {onFalse: () => screen.error, onTrue: Function.constUndefined})
	)
}
