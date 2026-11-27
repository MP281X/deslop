import './styles.css'

import {startApp} from '@deslop/ui/startup'

import {Trips} from '#web/flights/workspace.ts'
import {TripsRoute} from '#web/routes.ts'

startApp(TripsRoute, Trips)
