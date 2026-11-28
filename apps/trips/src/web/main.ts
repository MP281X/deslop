import './styles.css'

import {Router} from '@effect/ui'
import type {View} from '@effect/ui'
import {BrowserHost, BrowserRouter, Html} from '@effect/ui/html'

import {Array, Effect, Function, Layer, Option, Predicate, Schema, pipe} from 'effect'

import {ListDetail, styles, webStyle} from '@deslop/components/web'
import {addPageTelemetry} from '@deslop/runtime/web/client'

import {bookingAction, bookingSheet, tripsLayout} from '#screens/layout.ts'
import type {TripsNotice} from '#screens/layout.ts'
import {CloseFlight, TripsRoute} from '#screens/routes.ts'
import type {ScreenParts} from '#screens/trips.ts'
import {board, boardSkeleton, control, itineraryRows} from '#web/board.ts'
import {tripsScreen} from '#web/session.ts'

function booking<M>(h: Html.H<M>, screen: ScreenParts) {
	const choose = screen.file(h.input, 'change', value => {
		if (!Predicate.hasProperty(value, 'files') || !Array.isArray(value.files)) return undefined
		return Option.getOrUndefined(Array.head(value.files))
	})
	return bookingSheet<View.Input<M>>(
		screen,
		[
			h.p.style(webStyle(styles.heading)).children('Paste booking'),
			screen
				.text(h.textarea, 'input')
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
							disabled: Option.getOrUndefined(Option.liftPredicate('', () => screen.pending)),
							type: 'file'
						})
						.value('')
				)
		],
		[
			screen
				.cancel(control(h), 'click')
				.attrs({disabled: Option.getOrUndefined(Option.liftPredicate('', () => screen.pending)), type: 'button'})
				.children('Cancel'),
			screen
				.submit(control(h), 'click')
				.attrs({disabled: Option.getOrUndefined(Option.liftPredicate('', () => screen.submitDisabled)), type: 'button'})
				.children(bookingAction(screen.pending))
		]
	)
}

function notice<M>(h: Html.H<M>, banner: TripsNotice) {
	function action() {
		if (banner.back) return h.a.attr('href', '/').children(banner.label)
		return banner
			.action(control(h), 'click')
			.attr('disabled', Option.getOrUndefined(Option.liftPredicate('', () => banner.pending)))
			.children(banner.label)
	}
	return h.div.class('trips-notice').children(h.p.attr('role', 'status').children(banner.message), action())
}

const App = Html.component({
	message: Schema.Never,
	model: Schema.Null,
	name: 'TripsWeb',
	// fallow-ignore-next-line code-duplication -- Web and iPhone pass the same screen parts; only each host's elements differ.
	props: Schema.Struct({route: TripsRoute})
}).make({
	init: Function.constNull,
	update: Function.constNull,
	view: h =>
		tripsScreen.view<never, never>(h, h.props, screen => {
			const layout = tripsLayout<Html.H<never>, View.Input<never>>(h, screen, h.props.route, {
				board,
				boardSkeleton,
				booking,
				itineraryRows,
				missing: (host, message) => host.p.attr('role', 'status').children(message),
				notice
			})
			return h.div
				.style({height: '100%'})
				.children(
					ListDetail<never, never>(h, layout.panes),
					layout.report !== undefined && h.p.class('trips-report').attr('role', 'alert').children(layout.report)
				)
		})
})

const root = document.getElementById('root')
if (Predicate.isNull(root)) throw new TypeError('Missing application mount element with id "root"')
addPageTelemetry('@deslop/trips')

pipe(
	BrowserHost.mount(App, Router.props(TripsRoute), root),
	Layer.provide(tripsScreen.layer),
	Layer.provide(CloseFlight.layer),
	Layer.provide(BrowserRouter.layer({routes: TripsRoute})),
	Layer.launch,
	// oxlint-disable-next-line eslint/no-restricted-properties -- Mount one scoped root for the life of the document.
	Effect.runFork
)
