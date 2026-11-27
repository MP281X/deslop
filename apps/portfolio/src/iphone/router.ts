import {iphoneRouter} from '@deslop/design/native/router'

import {appOrigin, scheme} from '#iphone/origin.ts'
import {PortfolioRoute} from '#screens/routes.ts'

export const layerIPhoneRouter = iphoneRouter(PortfolioRoute, appOrigin, scheme, {validateInitial: true})
