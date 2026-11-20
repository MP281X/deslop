import {createFileRoute} from '@tanstack/react-router'

import {preload} from '@deslop/components-web/lib/router'

import {sessionsAtom} from '#lib/auth.ts'
import {Sessions} from '#lib/components.tsx'

export const Route = createFileRoute('/(home)/')({component: Sessions, loader: load => preload(load, [sessionsAtom])})
