import {Boolean, Function, Option, Result, String} from 'effect'

import {Button} from '@deslop/ui/control'
import {GlassPanel} from '@deslop/ui/glass'

import {itemOwner, requestOf, workloadName} from '#contracts'
import type {InventoryItem} from '#contracts'

import {Operation} from '#web/inventory/client.ts'
import {Glyph} from '#web/inventory/list.ts'
import {Message} from '#web/inventory/model.ts'
import type {H, Model} from '#web/inventory/model.ts'

const LOGS = 'deploy-logs'

export function AppActions(h: H, item: InventoryItem, pending: boolean, logs: Model['logs']) {
	if (Option.contains(item.scheduled, true)) {
		return Button(h, {disabled: pending || item.running})
			.attr('aria-label', 'Run now')
			.on('click', () => Message.Operation({operation: Operation.cases.Run.make({request: requestOf(item)})}))
			.children(Glyph(h, 'm8 5 12 7-12 7Z'))
	}
	if (item.kind !== 'service' || !Option.contains(item.owned, true)) return undefined
	const id = itemOwner(item)
	return [
		Button(h, {disabled: pending})
			.attr('aria-label', 'Restart')
			.on('click', () => Message.Operation({operation: Operation.cases.Restart.make({id})}))
			.children(Glyph(h, 'M20 4v5h-5m5 0a8 8 0 1 0 .4 6')),
		Button(h, {disabled: pending})
			.attrs({'aria-label': 'Logs', popovertarget: LOGS})
			.children(Glyph(h, 'M4 6h16M4 12h16M4 18h10')),
		Button(h, {disabled: pending || !(item.active || item.running)})
			.attr('aria-label', 'Stop')
			.on('click', () => Message.Operation({operation: Operation.cases.Stop.make({id})}))
			.children(Glyph(h, 'M7 7h10v10H7Z').attr('fill', 'currentColor')),
		GlassPanel(
			h,
			LOGS,
			`${workloadName(item)} logs`,
			Option.match(logs, {
				onNone: () => h.p.attr('role', 'status').children('Loading logs…'),
				onSome: result =>
					Result.match(result, {
						onFailure: error => h.p.attr('role', 'alert').children(error),
						onSuccess: text =>
							h.pre
								.attr('tabindex', '0')
								.children(
									Boolean.match(String.isEmpty(String.trim(text)), {
										onFalse: () => text,
										onTrue: Function.constant('No logs')
									})
								)
					})
			})
		)
			.key(id)
			.on('toggle', event => {
				if (event.open) return Message.OpenedLogs({id})
				return undefined
			})
	]
}
