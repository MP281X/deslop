import './notes/styles.css'

import {startApp} from '@deslop/ui/startup'

import {Stash} from '#web/notes/stash.ts'
import {StashRoute} from '#web/routes.ts'

startApp(StashRoute, Stash)
