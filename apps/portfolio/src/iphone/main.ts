import {Command, Router} from '@effect/ui'
import {Native, NativeApp} from '@effect/ui-native'

import {Boolean, Effect, Layer, Schema, pipe} from 'effect'

import Linking from 'react-native/Libraries/Linking/Linking'

import {layerIPhoneRouter} from '#iphone/router.ts'
import {Cv, Message, Profile} from '#iphone/view.ts'
import {PortfolioRoute} from '#screens/routes.ts'

const OpenLink = Command.make('Portfolio/OpenLink', {args: {url: Schema.String}}, ({url}) =>
	Effect.ignore(
		Effect.tryPromise(() => Linking.openURL(url)),
		{log: 'Warn', message: 'Could not open the link'}
	)
)

const Portfolio = Native.component({
	message: Message,
	model: PortfolioRoute,
	name: 'Portfolio',
	props: Schema.Struct({route: PortfolioRoute})
}).make({
	init: $ => $.props.route,
	subscriptions: $ => [Router.subscription(PortfolioRoute, $.model, route => Message.Routed({route}))],
	update: {
		Routed: (_, {route}) => route,
		OpenedLink: ($, {url}) => $.run(Command.asNoop(OpenLink.make({url}))),
		ShowCv: $ => $.run(Command.asNoop(Router.replace(PortfolioRoute, PortfolioRoute.Cv()))),
		ShowProfile: $ => $.run(Command.asNoop(Router.replace(PortfolioRoute, PortfolioRoute.Home())))
	},
	view: (h, model) =>
		Boolean.match(PortfolioRoute.isAnyOf(['Cv'])(model), {onFalse: () => Profile(h), onTrue: () => Cv(h)})
})

NativeApp.register(
	pipe(
		NativeApp.mount(Portfolio, Router.props(PortfolioRoute)),
		Layer.provide(Router.Replace.layer),
		Layer.provide(layerIPhoneRouter)
	)
)
