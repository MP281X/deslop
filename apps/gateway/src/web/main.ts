import './styles.css'

import {Router} from '@effect/ui'
import {BrowserHost, BrowserRouter} from '@effect/ui/html'

import {Effect, Layer, pipe} from 'effect'

import {AtomRegistry} from 'effect/reactivity'
import type {AsyncResult, Atom} from 'effect/reactivity'

import {aiKeyAtom, aiUsageAtom, mcpUsageAtom, serversAtom} from '#web/home/client.ts'
import {Gateway} from '#web/home/view.ts'
import {GatewayRoute, periodOf} from '#web/routes.ts'

// Start all four live reads together, but don't hold the page for a slow or failed read.
const props = Effect.tap(Router.props(GatewayRoute), state =>
	Effect.gen(function* () {
		if (!GatewayRoute.isAnyOf(['Home'])(state.route)) return
		const registry = yield* AtomRegistry.AtomRegistry
		const period = periodOf(state.route)
		function first<A, E>(atom: Atom.Atom<AsyncResult.AsyncResult<A, E>>) {
			return pipe(registry, AtomRegistry.getResult(atom), Effect.exit)
		}
		yield* Effect.timeoutOption(
			Effect.all([first(aiKeyAtom), first(serversAtom), first(aiUsageAtom(period)), first(mcpUsageAtom(period))], {
				concurrency: 'unbounded',
				discard: true
			}),
			'200 millis'
		)
	})
)

const root = document.getElementById('root')
if (root === null) throw new TypeError('Missing Gateway mount element')

pipe(
	BrowserHost.mount(Gateway, props, root, {head: false}),
	Layer.provide(
		Layer.merge(BrowserRouter.layer({routes: GatewayRoute}), AtomRegistry.layerOptions({defaultIdleTTL: 400}))
	),
	Layer.launch,
	// oxlint-disable-next-line eslint/no-restricted-properties -- BrowserHost owns the mounted app for the page lifetime.
	Effect.runFork
)
