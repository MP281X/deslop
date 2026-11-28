import {Boolean, Function, Option} from 'effect'

import type {ListOptions, PaneLeaf, Selection, SheetOptions} from '@deslop/components/model'

import type {BoardingPass, Itinerary} from '#screens/board.ts'
import {TripsRoute} from '#screens/routes.ts'
import type {ScreenParts} from '#screens/trips.ts'

export type TripsNotice = {action: Selection['back']; back: boolean; label: string; message: string; pending: boolean}

function noticeOf(screen: ScreenParts, route: TripsRoute) {
	if (screen.notice === undefined) return undefined
	const back = TripsRoute.isAnyOf(['NotFound'])(route)
	function label() {
		if (back) return 'Back to Trips'
		if (screen.signIn) return 'Continue with GitHub'
		return 'Retry'
	}
	return {
		action: Boolean.match(back, {onFalse: () => screen.retry, onTrue: () => screen.selection.back}),
		back,
		label: label(),
		message: screen.notice,
		pending: screen.pending
	} satisfies TripsNotice
}

export function tripsLayout<Host, Content>(
	h: Host,
	screen: ScreenParts,
	route: TripsRoute,
	draw: {
		board: (h: Host, pass: BoardingPass, screen: ScreenParts) => PaneLeaf<Content>
		itineraryRows: (
			h: Host,
			screen: ScreenParts,
			list: Itinerary,
			wide: boolean,
			id: Selection['id']
		) => PaneLeaf<Content>
		missing: (h: Host, text: string) => PaneLeaf<Content>
		notice: (h: Host, notice: TripsNotice) => PaneLeaf<Content>
		booking: (h: Host, screen: ScreenParts) => SheetOptions<Content>
		boardSkeleton: (h: Host) => PaneLeaf<Content>
	}
) {
	const notice = noticeOf(screen, route)
	function message() {
		return Option.getOrUndefined(Option.map(Option.fromUndefinedOr(notice), banner => draw.notice(h, banner)))
	}
	function detail() {
		if (screen.loading) return draw.boardSkeleton(h)
		if (screen.board !== undefined) return draw.board(h, screen.board, screen)
		if (screen.missing) {
			return draw.missing(
				h,
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
	return {
		panes: {
			defaultId: screen.defaultId,
			...(opened !== undefined && {detail: opened}),
			detailToolbar: screen.detailToolbar,
			...(empty !== undefined && {empty}),
			list: Option.getOrUndefined(
				Option.map(
					Option.fromUndefinedOr(screen.itinerary),
					itinerary => (id: Selection['id'], wide: boolean) => draw.itineraryRows(h, screen, itinerary, wide, id)
				)
			),
			loading: screen.loading,
			selection: screen.selection,
			sheet: draw.booking(h, screen),
			toolbar: screen.toolbar
		} satisfies ListOptions<Content>,
		report: Boolean.match(screen.pasteOpen, {onFalse: () => screen.error, onTrue: Function.constUndefined})
	}
}

export function bookingSheet<Content>(screen: ScreenParts, body: Content, actions: Content): SheetOptions<Content> {
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
