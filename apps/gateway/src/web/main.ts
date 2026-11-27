import './styles.css'

import {Router} from '@effect/ui'
import {BrowserHost, BrowserRouter, Html} from '@effect/ui/html'

import {Effect, Function, Layer, Predicate, Schema, pipe} from 'effect'

import {AtomRegistry} from 'effect/reactivity'

import {AuthError, signInUrl} from '@deslop/runtime/shared/auth'
import {accountAtom, addPageTelemetry, layerPageProtocol} from '@deslop/runtime/web/client'

import {Platform, layerActions} from '#screens/actions.ts'
import {GatewayView} from '#screens/gateway.ts'
import {GatewayReads} from '#screens/reads.ts'
import {GatewayRoute} from '#screens/routes.ts'
import {Workspace} from '#web/view.ts'

const App = Html.component({
	message: Schema.Never,
	model: Schema.Null,
	name: 'GatewayWeb',
	props: Schema.Struct({route: GatewayRoute})
}).make({
	init: Function.constNull,
	update: Function.constNull,
	view: h => GatewayView(h, {...h.props, autoSignIn: true}, screen => Workspace(h, screen))
})

function leave(navigate: () => void) {
	return Effect.andThen(Effect.sync(navigate), Effect.never)
}

const platform = Layer.succeed(Platform, {
	authenticate: signOut =>
		leave(() => {
			if (!signOut) {
				location.replace(signInUrl(location.href))
				return
			}
			const form = document.createElement('form')
			form.hidden = true
			form.method = 'post'
			form.action = `/auth/sign-out?${new URLSearchParams({next: location.href})}`
			document.body.append(form)
			form.submit()
		}),
	copy: Effect.tryPromise({
		catch: cause => AuthError.make({cause, message: 'Couldn’t copy MCP URL'}),
		try: () => navigator.clipboard.writeText(`${location.origin}/mcp`)
	}),
	open: path => leave(() => location.assign(path))
})

const root = document.getElementById('root')
if (Predicate.isNull(root)) throw new TypeError('Missing application mount element with id "root"')
addPageTelemetry('@deslop/gateway')

pipe(
	BrowserHost.mount(App, Router.props(GatewayRoute), root),
	Layer.provide(layerActions),
	Layer.provide(Layer.mergeAll(platform, GatewayReads.layer(layerPageProtocol, accountAtom), AtomRegistry.layer)),
	Layer.provide(BrowserRouter.layer({routes: GatewayRoute})),
	Layer.launch,
	// oxlint-disable-next-line eslint/no-restricted-properties -- Mount one scoped root for the life of the document.
	Effect.runFork
)
