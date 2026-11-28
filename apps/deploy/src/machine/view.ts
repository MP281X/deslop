import type {DeployScreen} from '#app'
import type {DeployUi} from '#view'

import {historyChart, historyNotices} from '#metrics/view.ts'

export function load(label: string, value?: string) {
	if (value === undefined) return []
	return [{label, value}]
}

export function overview<H, C, S>(host: H, screen: DeployScreen, ui: DeployUi<H, C, S>) {
	if (screen.machine === undefined) return undefined
	return [
		ui.headline(host, screen.machine.name),
		ui.figures(host, [
			{label: 'CPU', value: screen.machine.cpu},
			{label: 'Memory', value: screen.machine.memory},
			{label: 'Disk', value: screen.machine.disk}
		]),
		historyChart(host, screen, ui, screen.machine.readings, []),
		...historyNotices(host, screen, ui),
		...ui.facts(host, {
			values: [{label: 'Peak, mean', value: screen.machine.peak}, ...load('Load (1m / 5m / 15m)', screen.load)]
		})
	]
}
