import './styles.css'

import {addPageTelemetry} from '@deslop/runtime/web/client'
import {isNative} from '@deslop/ui/native'
import {startApp} from '@deslop/ui/startup'

import {Deploy} from '#web/inventory/view.ts'
import {DeployRoute} from '#web/routes.ts'

if (!isNative) addPageTelemetry('@deslop/deploy')
startApp(DeployRoute, Deploy)
