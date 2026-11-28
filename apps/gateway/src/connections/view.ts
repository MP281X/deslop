import {Option, pipe} from 'effect'

import type {GatewayScreen} from '#app'
import type {GatewayUi} from '#view'

import type {ServerRow} from './screen.ts'

export function serverRow<H, C, S>(host: H, screen: GatewayScreen, ui: GatewayUi<H, C, S>, row: ServerRow) {
	return ui.entry(
		host,
		row.item.id,
		ui.row(host, {
			active: false,
			item: row.item,
			trailing: pipe(
				Option.fromUndefinedOr(row.action),
				Option.map(action =>
					ui.button(host, {
						description: `${action} ${row.item.title}`,
						disabled: screen.busy,
						label: action,
						press: (element, event) => screen.connect(element, event, row.id)
					})
				),
				Option.getOrUndefined
			)
		})
	)
}
