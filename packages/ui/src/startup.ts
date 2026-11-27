import {Router} from '@effect/ui'
import type {Component, View} from '@effect/ui'
import {BrowserHost, BrowserRouter} from '@effect/ui/html'
import type {Html} from '@effect/ui/html'

import {Effect, Layer, pipe} from 'effect'

export function startApp<U extends Router.Routes, N extends string, Model, Msg, Events, V extends View.Elements, L>(
	routes: U,
	app: Component.Members<N, {readonly route: U['Type']}, Model, Msg, Events, Html.Host | Router.Services, V, L> &
		BrowserHost.HtmlRoot<V>
) {
	const root = document.getElementById('root')
	if (root === null) return
	pipe(
		BrowserHost.mount(app, Router.props(routes), root, {head: false}),
		Layer.provide(BrowserRouter.layer({routes})),
		Layer.launch,
		// oxlint-disable-next-line eslint/no-restricted-properties -- BrowserHost owns the mounted app for the page lifetime.
		Effect.runFork
	)
}
