import './styles.css'

import {startApp} from '@deslop/ui/startup'

import {Auth} from '#web/auth/view.ts'
import {AuthRoute} from '#web/routes.ts'

startApp(AuthRoute, Auth)
