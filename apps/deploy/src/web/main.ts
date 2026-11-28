import {Router} from '@effect/ui'
import type {View} from '@effect/ui'
import {BrowserHost, Html} from '@effect/ui/html'

import {Layer, Option} from 'effect'

import type {PaneLeaf} from '@deslop/components/model'
import {status} from '@deslop/components/web'
import {webComponents} from '@deslop/components/web/components'
import {mountPage} from '@deslop/components/web/page'
import {layerWebShell} from '@deslop/runtime/web/shell'

import {DeployApp} from '#app'
import {DeployRoute, layerDeploy} from '#reads'
import {Workspace} from '#view'
import type {DeployUi, SiteRow} from '#view'

function Site<M>(h: Html.H<M>, site: SiteRow) {
	return h.div
		.key(site.id)
		.children(
			Option.match(Option.fromUndefinedOr(site.url), {
				onNone: () => h.span.children(site.label),
				onSome: url =>
					h.a
						.style({color: 'inherit'})
						.attrs({href: url, rel: 'noreferrer', target: '_blank', title: url})
						.children(site.label)
			}),
			site.status !== undefined && h.span.style({color: status[site.status]}).children(` · ${site.line ?? ''}`)
		)
}

const drawing: DeployUi<Html.H<never>, PaneLeaf<View.Input<never>>, View.Content<never>> = {
	...webComponents<never>(),
	site: Site
}

const App = DeployApp(Html.vocabulary, (h, screen) => Workspace(h, screen, drawing))

mountPage(DeployRoute, root =>
	Layer.provide(
		BrowserHost.mount(App, Router.props(DeployRoute), root),
		Layer.provideMerge(layerDeploy, layerWebShell('deploy'))
	)
)
