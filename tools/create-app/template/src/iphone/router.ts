import {Predicate} from 'effect'

import {iphoneRouter} from '@deslop/design/native/router'

import {appOrigin, scheme} from '#iphone/origin.ts'
import {AppRoute} from '#screens/routes.ts'

export const layerIPhoneRouter = iphoneRouter(AppRoute, appOrigin, scheme, {
	replace: location => Predicate.isTagged(location.route, 'Item')
})
