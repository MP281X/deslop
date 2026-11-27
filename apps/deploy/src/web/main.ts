import './styles.css'

import {addPageTelemetry} from '@deslop/runtime/web/client'
import {startApp} from '@deslop/ui/startup'

import {Deploy} from '#web/inventory/view.ts'
import {DeployRoute} from '#web/routes.ts'

addPageTelemetry('@deslop/deploy')
startApp(DeployRoute, Deploy)
