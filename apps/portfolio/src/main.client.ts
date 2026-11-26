import './routes/styles.css'

import {BrowserHost} from '@effect/ui/html'

import {Effect, Layer, Option, Predicate, String} from 'effect'

const page = Effect.gen(function* () {
	const root = document.getElementById('root')
	if (Predicate.isNull(root)) return yield* Effect.die('Portfolio has no mount element')
	if (Option.isSome(String.match(/^\/cv\/?$/iu)(location.pathname))) {
		return yield* Layer.launch(BrowserHost.mount((yield* Effect.promise(() => import('#routes/cv.ts'))).Cv, {}, root))
	}
	return yield* Layer.launch(
		BrowserHost.mount((yield* Effect.promise(() => import('#routes/(home)/index.ts'))).Portfolio, {}, root)
	)
})

// eslint-disable-next-line eslint/no-restricted-properties -- BrowserHost owns a page-lifetime scope; there is no Node or React runtime here.
Effect.runFork(page)
