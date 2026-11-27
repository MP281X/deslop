import {Option} from 'effect'

import type {ShellAction} from '@deslop/ui/app-shell'

import {itemOwner, requestOf, workloadName} from '#contracts'
import type {InventoryItem} from '#contracts'

import {Operation} from '#web/inventory/client.ts'
import {Message} from '#web/inventory/model.ts'

export function runJob(item: InventoryItem) {
	return Message.Operation({operation: Operation.cases.Run.make({request: requestOf(item)})})
}

export function AppActions(item: InventoryItem, pending: boolean): readonly ShellAction<Message>[] {
	if (Option.contains(item.scheduled, true)) {
		return [
			{disabled: pending || item.running, id: 'run', message: runJob(item), symbol: 'play.fill', title: 'Run now'}
		]
	}
	if (item.kind !== 'service' || !Option.contains(item.owned, true)) return []
	const id = itemOwner(item)
	return [
		{
			disabled: pending,
			id: 'restart',
			message: Message.Operation({operation: Operation.cases.Restart.make({id})}),
			symbol: 'arrow.clockwise',
			title: 'Restart'
		},
		{
			disabled: pending,
			id: 'logs',
			message: Message.OpenedLogs({id, name: workloadName(item)}),
			symbol: 'doc.text',
			title: 'Logs'
		},
		{
			disabled: pending || !(item.active || item.running),
			id: 'stop',
			message: Message.Operation({operation: Operation.cases.Stop.make({id})}),
			symbol: 'stop.fill',
			title: 'Stop'
		}
	]
}
