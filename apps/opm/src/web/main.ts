import './styles.css'

import {Router} from '@effect/ui'
import {BrowserHost, BrowserRouter} from '@effect/ui/html'

import {Effect, Layer, Predicate, pipe} from 'effect'

import {AtomRegistry} from 'effect/reactivity'

import {Opm} from '#web/chapters/library.ts'
import {OpmCommands} from '#web/chapters/model.ts'
import {OpmRoute} from '#web/routes.ts'

const root = document.getElementById('root')
if (Predicate.isNull(root)) throw new TypeError('Missing application mount element with id "root"')

pipe(
	BrowserHost.mount(Opm, Router.props(OpmRoute), root),
	Layer.provide(BrowserRouter.layer({routes: OpmRoute})),
	Layer.provide(OpmCommands),
	Layer.provide(AtomRegistry.layer),
	Layer.launch,
	// oxlint-disable-next-line eslint/no-restricted-properties -- The BrowserHost layer lives for this web page, which has no Node runtime.
	Effect.runFork
)
