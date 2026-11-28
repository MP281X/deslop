import './styles.css'

import {Router} from '@effect/ui'
import type {View} from '@effect/ui'
import {BrowserHost, Html} from '@effect/ui/html'

import {Effect, Layer, Option, pipe} from 'effect'

import {AtomRegistry} from 'effect/reactivity'

import type {PaneLeaf} from '@deslop/components/model'
import {status} from '@deslop/components/web'
import {webComponents} from '@deslop/components/web/components'
import {mountPage} from '@deslop/components/web/page'
import {accountAtom, addPageTelemetry, layerPageProtocol, pageSignIn} from '@deslop/runtime/web/client'

import {DeployApp} from '#app'
import {Authenticate, DeployReads, DeployRoute, Execute, OpenEndpoint, Refresh} from '#reads'
import {Workspace} from '#view'

import type {DeployUi, Exposure} from '#exposures/view.ts'

function Site<M>(h: Html.H<M>, site: Exposure) {
	return h.div
		.key(site.id)
		.children(
			Option.match(Option.fromUndefinedOr(site.url), {
				onNone: () => h.span.children(site.label),
				onSome: url => h.a.attrs({href: url, rel: 'noreferrer', target: '_blank', title: url}).children(site.label)
			}),
			site.status !== undefined && h.span.style({color: status[site.status]}).children(` · ${site.line ?? ''}`)
		)
}

const drawing: DeployUi<Html.H<never>, PaneLeaf<View.Input<never>>, View.Content<never>> = {
	...webComponents<never>(),
	site: Site
}

const App = DeployApp(Html.vocabulary, true, (h, screen) => Workspace(h, screen, drawing))

mountPage(DeployRoute, root => {
	addPageTelemetry('@deslop/deploy')
	const reads = Layer.merge(DeployReads.layer(layerPageProtocol, accountAtom), AtomRegistry.layer)
	return pipe(
		BrowserHost.mount(App, Router.props(DeployRoute), root),
		Layer.provide(pipe(Execute.layer, Layer.merge(Refresh.layer), Layer.provideMerge(reads))),
		Layer.provide(
			Layer.merge(
				Authenticate.toLayer(() => pageSignIn),
				OpenEndpoint.toLayer(() => Effect.void)
			)
		)
	)
})
