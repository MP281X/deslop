import {Option} from 'effect'

import {iphoneRouter} from '@deslop/design/native/router'

import {appOrigin, scheme} from '#iphone/origin.ts'
import {DeployRoute, isDetail} from '#screens/routes.ts'

export const layerIPhoneRouter = iphoneRouter(DeployRoute, appOrigin, scheme, {
	replace: location => Option.exists(DeployRoute.parse(location.url), isDetail)
})
