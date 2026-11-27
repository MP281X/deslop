import {Loading} from '@deslop/ui/axis'

import type {H} from '#web/inventory/model.ts'

export function LoadingApps(h: H) {
	return Loading(h, 'Loading apps', h.div.class('deploy-list-skeleton').attr('aria-hidden', 'true'))
}

export function LoadingReadings(h: H) {
	return Loading(h, 'Loading readings', h.div.class('deploy-reading-skeleton').attr('aria-hidden', 'true'))
}
