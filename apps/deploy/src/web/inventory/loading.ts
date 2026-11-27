import {Loading, Placeholder} from '@deslop/ui/axis'

import type {H} from '#web/inventory/model.ts'

export function LoadingMachine(h: H) {
	return [
		Placeholder(h, 'deploy-hero-placeholder'),
		Placeholder(h, 'h-7 w-full'),
		Placeholder(h, 'mt-2 h-9 w-full'),
		Placeholder(h, 'mt-2 h-9 w-full')
	]
}

export function LoadingApps(h: H) {
	return Loading(h, 'Loading apps', h.div.class('deploy-list-skeleton').attr('aria-hidden', 'true'))
}

export function LoadingReadings(h: H) {
	return Loading(h, 'Loading readings', h.div.class('deploy-reading-skeleton').attr('aria-hidden', 'true'))
}

export function LoadingDetail(h: H) {
	return Loading(
		h,
		'Loading app',
		h.div.class('deploy-startup-detail').attr('aria-hidden', 'true').children(h.div.class('deploy-reading-skeleton'))
	)
}
