import {createFileRoute} from '@tanstack/react-router'

import {Sessions} from '#lib/components.tsx'

export const Route = createFileRoute('/(home)/')({component: Sessions})
