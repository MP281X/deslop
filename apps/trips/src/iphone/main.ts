import 'react-native/Libraries/Core/setUpXHR'

import {Router} from '@effect/ui'
import {Native, NativeApp} from '@effect/ui-native'

import {Effect, Function, Layer, Schema, pipe} from 'effect'

import {Atom} from 'effect/reactivity'

import {ListDetail, black, ink, styles} from '@deslop/components/native'
import {layerSocketProtocol} from '@deslop/runtime/client/protocol'
import {layerOtlp} from '@deslop/runtime/shared/telemetry'

import {board, boardSkeleton, control, itineraryRows} from '#iphone/board.ts'
import {deviceEvents, initialPath, openUrl, push} from '#iphone/device.ts'
import {appOrigin} from '#iphone/origin.ts'
import {iPhoneAccountAtom, refreshAccount, session, signOut} from '#iphone/session.ts'
import {flightCache} from '#iphone/store.ts'
import {chooseTicket} from '#iphone/ticket.ts'
import {tripsData} from '#screens/data.ts'
import {bookingAction, bookingSheet, tripsLayout} from '#screens/layout.ts'
import type {TripsNotice} from '#screens/layout.ts'
import {CloseFlight, TripsRoute} from '#screens/routes.ts'
import {makeTrips} from '#screens/trips.ts'
import type {ScreenParts} from '#screens/trips.ts'

if (new URL(appOrigin).hostname === 'trips.mp281x.xyz') {
	Atom.runtime.addGlobalLayer(layerOtlp('@deslop/trips-ios', 'https://scope.mp281x.xyz', 'mobile', '0.1.0'))
}

const boardReads = tripsData({
	account: iPhoneAccountAtom,
	cache: flightCache,
	protocol: layerSocketProtocol(session.layerIPhoneSocket),
	push,
	refreshAccount
})
const tripsScreen = makeTrips(boardReads, {
	deviceEvents,
	openUrl,
	signIn: session.signIn,
	signOut,
	ticket: () => chooseTicket
})

function booking<M>(h: Native.H<M>, screen: ScreenParts) {
	const cancel = screen.cancel(screen.cancel(h.view, 'press'), 'accessibilityTap')
	const submit = screen.submit(screen.submit(h.view, 'press'), 'accessibilityTap')
	const choose = screen.choose(screen.choose(h.view, 'press'), 'accessibilityTap')
	const sheet = bookingSheet<Native.NoTextInput<M>>(
		screen,
		h.view.style({alignItems: 'stretch', gap: 12}).children(
			h.text.style(styles.heading).children('Paste booking'),
			screen
				.text(h.input, 'input')
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
		[
			control(h, cancel, 'Cancel', screen.pending),
			control(h, submit, bookingAction(screen.pending), screen.submitDisabled)
		]
	)
	return {...sheet, height: 0.6}
}

function notice<M>(h: Native.H<M>, banner: TripsNotice) {
	return h.view
		.style({alignItems: 'flex-start', padding: 16})
		.children(
			h.text.style(styles.body).children(banner.message),
			control(h, banner.action(banner.action(h.view, 'press'), 'accessibilityTap'), banner.label, banner.pending)
		)
}

const App = Native.component({
	message: Schema.Never,
	model: Schema.Null,
	name: 'TripsIPhone',
	// fallow-ignore-next-line code-duplication -- Web and iPhone pass the same screen parts; only each host's elements differ.
	props: Schema.Struct({route: TripsRoute})
}).make({
	init: Function.constNull,
	update: Function.constNull,
	view: h =>
		tripsScreen.view<never, never>(h, h.props, screen => {
			const layout = tripsLayout<Native.H<never>, Native.NoTextInput<never>>(h, screen, h.props.route, {
				board,
				boardSkeleton,
				booking,
				itineraryRows,
				missing: (host, message) => host.text.style(styles.body).children(message),
				notice
			})
			return h.view.style({flex: 1}).children(
				ListDetail<never, never>(h, layout.panes),
				layout.report !== undefined &&
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
						.children(layout.report)
			)
		})
})

const router = Layer.unwrap(Effect.map(initialPath, url => Router.memory({routes: TripsRoute, url})))

NativeApp.register(
	pipe(
		NativeApp.mount(App, Router.props(TripsRoute)),
		Layer.provide(tripsScreen.layer),
		Layer.provide(CloseFlight.layer),
		Layer.provide(router)
	)
)
