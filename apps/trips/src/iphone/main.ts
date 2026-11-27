import 'react-native/Libraries/Core/setUpXHR'

import {Router} from '@effect/ui'
import {Native, NativeApp} from '@effect/ui-native'

import {Effect, Function, Layer, Predicate, Schema, pipe} from 'effect'

import {Atom} from 'effect/reactivity'

import {ListDetail, black, ink, styles} from '@deslop/design/native'
import {layerSocketProtocol} from '@deslop/runtime/client/protocol'
import {layerOtlp} from '@deslop/runtime/shared/telemetry'

import {board, boardSkeleton, control, itineraryRows} from '#iphone/board.ts'
import {deviceEvents, initialPath, openUrl, push} from '#iphone/device.ts'
import {appOrigin} from '#iphone/origin.ts'
import {account, layerIPhoneSocket, refreshAccount, signIn, signOut} from '#iphone/session.ts'
import {flightCache} from '#iphone/store.ts'
import {chooseTicket} from '#iphone/ticket.ts'
import {tripsData} from '#screens/data.ts'
import {CloseFlight, TripsRoute} from '#screens/routes.ts'
import {makeTrips} from '#screens/trips.ts'
import type {ScreenParts} from '#screens/trips.ts'

if (new URL(appOrigin).hostname === 'trips.mp281x.xyz') {
	Atom.runtime.addGlobalLayer(layerOtlp('@deslop/trips-ios', 'https://scope.mp281x.xyz', 'mobile', '0.1.0'))
}

const data = tripsData({
	account,
	cache: flightCache,
	protocol: layerSocketProtocol(layerIPhoneSocket),
	push,
	refreshAccount
})
const {view: TripsView, layer: layerTrips} = makeTrips(data, {
	deviceEvents,
	openUrl,
	signIn,
	signOut,
	ticket: () => chooseTicket
})

function booking<M>(h: Native.H<M>, screen: ScreenParts) {
	const input = screen.text(h.input, 'input', value => {
		if (!Predicate.hasProperty(value, 'value') || !Predicate.isString(value.value)) return undefined
		return value.value
	})
	const cancel = screen.cancel(screen.cancel(h.view, 'press'), 'accessibilityTap')
	const submit = screen.submit(screen.submit(h.view, 'press'), 'accessibilityTap')
	const choose = screen.choose(screen.choose(h.view, 'press'), 'accessibilityTap')
	return {
		actions: [
			control(h, cancel, 'Cancel', screen.pending),
			control(h, submit, screen.pending ? 'Adding…' : 'Add booking', screen.submitDisabled)
		],
		body: h.view.style({alignItems: 'stretch', gap: 12}).children(
			h.text.style(styles.heading).children('Paste booking'),
			input
				.style({...styles.body, backgroundColor: black, borderRadius: 8, minHeight: 96, padding: 10})
				.prop('value', screen.pastedText)
				.prop('editable', !screen.pending)
				.prop('multiline', true)
				.prop('placeholderTextColor', styles.line.color)
				.prop('accessibilityLabel', 'Paste booking text or link')
				.prop('placeholder', 'Paste booking text or link'),
			screen.error !== undefined && h.text.style(styles.body).prop('accessibilityRole', 'alert').children(screen.error),
			control(h, choose, 'Choose an image or PDF', screen.pending)
		),
		dismiss: screen.cancel,
		height: 0.6,
		label: 'Paste booking',
		open: screen.pasteOpen,
		pending: screen.pending
	}
}

const App = Native.component({
	message: Schema.Never,
	model: Schema.Null,
	name: 'TripsIPhone',
	props: Schema.Struct({route: TripsRoute})
}).make({
	init: Function.constNull,
	update: Function.constNull,
	view: h =>
		TripsView(h, h.props, screen => {
			const list = screen.itinerary
			function notice() {
				if (screen.notice === undefined) return undefined
				const back = TripsRoute.isAnyOf(['NotFound'])(h.props.route)
				const part = back ? screen.back : screen.retry
				return h.view
					.style({alignItems: 'flex-start', padding: 16})
					.children(
						h.text.style(styles.body).children(screen.notice),
						control(
							h,
							part(part(h.view, 'press'), 'accessibilityTap'),
							back ? 'Back to Trips' : screen.signIn ? 'Continue with GitHub' : 'Retry',
							screen.pending
						)
					)
			}
			function detail() {
				if (screen.loading) return boardSkeleton(h)
				if (screen.board !== undefined) return board(h, screen.board, screen)
				if (screen.missing)
					return h.text.style(styles.body).children(screen.stale ? 'Flight not loaded' : 'Flight not found')
				if (screen.selection.id !== undefined) return notice()
				return undefined
			}
			return h.view.style({flex: 1}).children(
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
					h.text
						.style({
							...styles.body,
							backgroundColor: styles.control.backgroundColor,
							bottom: 16,
							color: ink,
							left: 16,
							padding: 10,
							position: 'absolute'
						})
						.prop('accessibilityRole', 'alert')
						.children(screen.error)
			)
		})
})

const router = Layer.unwrap(Effect.map(initialPath, url => Router.memory({routes: TripsRoute, url})))

NativeApp.register(
	pipe(
		NativeApp.mount(App, Router.props(TripsRoute)),
		Layer.provide(layerTrips),
		Layer.provide(CloseFlight.layer),
		Layer.provide(router)
	)
)
