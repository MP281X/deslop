import {Option} from 'effect'

import {iphoneRouter} from '@deslop/components/native/router'

import {appOrigin, scheme} from '#iphone/origin.ts'
import {StashRoute, showsDetail} from '#screens/routes.ts'

export const layerIPhoneRouter = iphoneRouter(StashRoute, appOrigin, scheme, {
	replace: location => Option.exists(StashRoute.parse(location.url), showsDetail)
})
