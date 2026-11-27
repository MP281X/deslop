import './styles.css'

import {startApp} from '@deslop/ui/startup'

import {Gateway} from '#web/home/view.ts'
import {GatewayRoute} from '#web/routes.ts'

startApp(GatewayRoute, Gateway)
