import {iphoneRouter} from '@deslop/design/native/router'

import {appOrigin, scheme} from '#iphone/origin.ts'
import {GatewayRoute} from '#screens/routes.ts'

export const layerIPhoneRouter = iphoneRouter(GatewayRoute, appOrigin, scheme)
