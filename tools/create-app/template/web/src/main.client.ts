import './routes/styles.css'

import {BrowserHost} from '@effect/ui/html'

import {Effect, Layer, Predicate, pipe} from 'effect'

import {AtomRegistry} from 'effect/reactivity'

import {App} from '#routes/index.ts'

const root = document.getElementById('root')
if (Predicate.isNull(root)) throw new TypeError('Missing application mount element with id "root"')

pipe(
	BrowserHost.mount(App, {}, root),
	Layer.provide(AtomRegistry.layer),
	Layer.launch,
	// oxlint-disable-next-line eslint/no-restricted-properties -- The browser mounts one scoped Effect UI root for the lifetime of the page.
	Effect.runFork
)
