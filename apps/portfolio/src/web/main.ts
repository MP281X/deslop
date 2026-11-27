import './styles.css'

import {BrowserHost} from '@effect/ui/html'

import {Effect, Layer, Option, Predicate} from 'effect'

import {PortfolioRoute} from '#screens/routes.ts'

const page = Effect.gen(function* () {
	const root = document.getElementById('root')
	if (Predicate.isNull(root)) return yield* Effect.die('Portfolio has no mount element')

	// The printable CV opens without loading the public presence client.
	if (Option.exists(PortfolioRoute.parse(location.pathname), PortfolioRoute.isAnyOf(['Cv']))) {
		return yield* Layer.launch(BrowserHost.mount((yield* Effect.promise(() => import('#web/cv/view.ts'))).Cv, {}, root))
	}
	return yield* Layer.launch(
		BrowserHost.mount((yield* Effect.promise(() => import('#web/home/view.ts'))).Portfolio, {}, root)
	)
})

// eslint-disable-next-line eslint/no-restricted-properties -- BrowserHost owns a page-lifetime scope.
Effect.runFork(page)
