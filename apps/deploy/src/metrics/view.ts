import type {DateTime} from 'effect'

import type {Reading} from '@deslop/components/chart'

import type {DeployScreen} from '#app'

import type {DeployUi} from '#exposures/view.ts'

export function history<H, C, S>(
	host: H,
	screen: DeployScreen,
	ui: DeployUi<H, C, S>,
	readings: readonly Reading[],
	restarts: readonly DateTime.Utc[]
) {
	if (screen.historyLoading) return ui.skeleton(host)
	return ui.history(host, {
		empty: 'No CPU readings in the last hour',
		now: screen.now,
		readings,
		restarts,
		title: 'CPU · Past hour'
	})
}

export function historyStatus<H, C, S>(host: H, screen: DeployScreen, ui: DeployUi<H, C, S>) {
	if (screen.historyStatus === undefined) return []
	if (screen.historyStatus.retry) return [ui.notice(host, screen.historyStatus.text, screen.retry)]
	return [ui.notice(host, screen.historyStatus.text)]
}
