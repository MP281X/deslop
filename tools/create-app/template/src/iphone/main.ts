import {Router} from '@effect/ui'
import {Native, NativeApp} from '@effect/ui-native'

import {Layer} from 'effect'

import {nativeComponents} from '@deslop/components/native/components'
import {layerIPhoneShell} from '@deslop/runtime/iphone/shell'

import {ItemsApp} from '#app'
import {AppRoute, isDetail, layerReads} from '#reads'
import {Workspace} from '#view'

const App = ItemsApp(Native.vocabulary, (h, screen) => Workspace(h, screen, nativeComponents<never>()))

NativeApp.register(
	Layer.provide(
		NativeApp.mount(App, Router.props(AppRoute)),
		Layer.provideMerge(layerReads, layerIPhoneShell({name: 'template-app', replace: isDetail, route: AppRoute}))
	)
)
