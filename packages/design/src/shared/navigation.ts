import {Router} from '@effect/ui'

import {Effect} from 'effect'

export function backOrHome(home: Router.Location['route']) {
	return Effect.map(
		Router.Router,
		router => () =>
			Effect.suspend(() => {
				if (router.location().action === 'initial') return router.replace(home)
				return router.back
			})
	)
}
