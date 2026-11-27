import './styles.css'

import {startApp} from '@deslop/ui/startup'

import {Opm} from '#web/chapters/library.ts'
import {OpmRoute} from '#web/routes.ts'

startApp(OpmRoute, Opm)
