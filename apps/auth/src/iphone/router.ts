import {Option} from 'effect'

import {iphoneRouter} from '@deslop/components/native/router'

import {appOrigin, scheme} from '#iphone/origin.ts'
import {AuthRoute} from '#screens/routes.ts'

export const layerIPhoneRouter = iphoneRouter(AuthRoute, appOrigin, scheme, {
	replace: location =>
		Option.exists(
			AuthRoute.parse(location.url),
			current => AuthRoute.isAnyOf(['Home'])(current) && current.search.person !== undefined
		)
})
