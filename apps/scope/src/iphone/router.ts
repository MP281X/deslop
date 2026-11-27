import {Option} from 'effect'

import {iphoneRouter} from '@deslop/design/native/router'

import {appOrigin, scheme} from '#iphone/origin.ts'
import {levelOf} from '#screens/model.ts'
import {ScopeRoute} from '#screens/routes.ts'

export const layerIPhoneRouter = iphoneRouter(ScopeRoute, appOrigin, scheme, {
	replace: location => Option.exists(ScopeRoute.parse(location.url), value => levelOf(value.search) > 0)
})
