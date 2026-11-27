import './styles.css'

import {Router} from '@effect/ui'
import {BrowserHost, BrowserRouter, Html} from '@effect/ui/html'

import {Array, Effect, Function, Layer, Option, Predicate, Schema, pipe} from 'effect'

import {ListDetail, styles, webStyle} from '@deslop/design/web'
import {addPageTelemetry} from '@deslop/runtime/web/client'

import {CloseFlight, TripsRoute} from '#screens/routes.ts'
import type {ScreenParts} from '#screens/trips.ts'
import {board, boardSkeleton, control, itineraryRows} from '#web/board.ts'
import {TripsView, layerTrips} from '#web/session.ts'

function booking<M>(h: Html.H<M>, screen: ScreenParts) {
	const choose = screen.file(h.input, 'change', value => {
		if (!Predicate.hasProperty(value, 'files') || !Array.isArray(value.files)) return undefined
		return Option.getOrUndefined(Array.head(value.files))
	})
	return {
		actions: [
			screen
				.cancel(control(h), 'click')
				.attrs({disabled: screen.pending ? '' : undefined, type: 'button'})
				.children('Cancel'),
			screen
				.submit(control(h), 'click')
				.attrs({disabled: screen.submitDisabled ? '' : undefined, type: 'button'})
				.children(screen.pending ? 'Adding…' : 'Add booking')
		],
		body: [
			h.p.style(webStyle(styles.heading)).children('Paste booking'),
			screen
				.text(h.textarea, 'input', value => {
					if (!Predicate.hasProperty(value, 'value') || !Predicate.isString(value.value)) return undefined
					return value.value
				})
				.attrs({'aria-label': 'Paste booking text or link', placeholder: 'Paste booking text or link'})
				.value(screen.pastedText),
			screen.error !== undefined && h.p.attr('role', 'alert').children(screen.error),
			h.label
				.class('trips-file-control')
				.style(webStyle(styles.control))
				.children(
					'Choose an image or PDF',
					choose
						.attrs({
							accept: 'image/*,application/pdf',
							'aria-label': 'Choose an image or PDF',
							disabled: screen.pending ? '' : undefined,
							type: 'file'
						})
						.value('')
				)
		],
		dismiss: screen.cancel,
		label: 'Paste booking',
		open: screen.pasteOpen,
		pending: screen.pending
	}
}

const App = Html.component({
	message: Schema.Never,
	model: Schema.Null,
	name: 'TripsWeb',
	props: Schema.Struct({route: TripsRoute})
}).make({
	init: Function.constNull,
	update: Function.constNull,
	view: h =>
		TripsView(h, h.props, screen => {
			const list = screen.itinerary
			function notice() {
				if (screen.notice === undefined) return undefined
				return h.div.class('trips-notice').children(
					h.p.attr('role', 'status').children(screen.notice),
					TripsRoute.isAnyOf(['NotFound'])(h.props.route)
						? h.a.attr('href', '/').children('Back to Trips')
						: screen
								.retry(control(h), 'click')
								.attr('disabled', screen.pending ? '' : undefined)
								.children(screen.signIn ? 'Continue with GitHub' : 'Retry')
				)
			}
			function detail() {
				if (screen.loading) return boardSkeleton(h)
				if (screen.board !== undefined) return board(h, screen.board, screen)
				if (screen.missing)
					return h.p.attr('role', 'status').children(screen.stale ? 'Flight not loaded' : 'Flight not found')
				if (screen.selection.id !== undefined) return notice()
				return undefined
			}
			return h.div
				.style({height: '100%'})
				.children(
					ListDetail(h, {
						defaultId: screen.defaultId,
						detail: detail(),
						detailToolbar: screen.detailToolbar,
						empty: notice(),
						list: list === undefined ? undefined : (id, wide) => itineraryRows(h, screen, list, id, wide),
						loading: screen.loading,
						selection: screen.selection,
						sheet: booking(h, screen),
						toolbar: screen.toolbar
					}),
					!screen.pasteOpen &&
						screen.error !== undefined &&
						h.p.class('trips-report').attr('role', 'alert').children(screen.error)
				)
		})
})

const root = document.getElementById('root')
if (Predicate.isNull(root)) throw new TypeError('Missing application mount element with id "root"')
addPageTelemetry('@deslop/trips')

pipe(
	BrowserHost.mount(App, Router.props(TripsRoute), root),
	Layer.provide(layerTrips),
	Layer.provide(CloseFlight.layer),
	Layer.provide(BrowserRouter.layer({routes: TripsRoute})),
	Layer.launch,
	// oxlint-disable-next-line eslint/no-restricted-properties -- Mount one scoped root for the life of the document.
	Effect.runFork
)
