import {Router} from '@effect/ui'
import type {View} from '@effect/ui'
import {Native, NativeApp} from '@effect/ui-native'

import {Layer, Option} from 'effect'

import type {PaneLeaf, Press} from '@deslop/components/model'
import {status, styles} from '@deslop/components/native'
import {nativeComponents} from '@deslop/components/native/components'
import {layerIPhoneShell} from '@deslop/runtime/iphone/shell'

import {DeployApp} from '#app'
import {DeployRoute, isDetail, layerDeploy} from '#reads'
import {Workspace} from '#view'
import type {DeployUi, SiteRow} from '#view'

function Site<M>(h: Native.H<M>, site: SiteRow, open: (url: string) => Press) {
	const components = nativeComponents<M>()
	return h.view
		.key(site.id)
		.style(styles.titleLine)
		.children(
			site.status !== undefined && h.view.style({...styles.dot, backgroundColor: status[site.status]}),
			Option.match(Option.fromUndefinedOr(site.url), {
				onNone: () => h.text.style(styles.body).children(site.label),
				onSome: url => components.button(h, {label: site.label, press: open(url)})
			}),
			site.line !== undefined && h.text.style({...styles.line, flexShrink: 1}).children(site.line)
		)
}

const drawing: DeployUi<Native.H<never>, PaneLeaf<Native.NoTextInput<never>>, View.Content<never>> = {
	...nativeComponents<never>(),
	site: Site
}

const App = DeployApp(Native.vocabulary, (h, screen) => Workspace(h, screen, drawing))

NativeApp.register(
	Layer.provide(
		NativeApp.mount(App, Router.props(DeployRoute)),
		Layer.provideMerge(layerDeploy, layerIPhoneShell({name: 'deploy', replace: isDetail, route: DeployRoute}))
	)
)
