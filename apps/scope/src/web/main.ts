import './styles.css'

import {startApp} from '@deslop/ui/startup'

import {ScopeRoute} from '#web/routes.ts'
import {Scope} from '#web/telemetry/operations.ts'

startApp(ScopeRoute, Scope)
