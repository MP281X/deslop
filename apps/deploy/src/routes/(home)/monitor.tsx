import {createFileRoute, useSearch} from '@tanstack/react-router'

import {ResourceHistory} from '#routes/(home)/-metrics.tsx'

function Monitor() {
	return <ResourceHistory machine={useSearch({from: '/(home)'}).machine ?? 'all'} />
}

export const Route = createFileRoute('/(home)/monitor')({component: Monitor})
