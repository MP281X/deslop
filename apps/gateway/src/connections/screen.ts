import {Array, Boolean, Function, HashMap, Number, Option, Order, Schema, pipe} from 'effect'

import {AsyncResult} from 'effect/reactivity'

import type {RowData} from '@deslop/components/model'
import {countOf} from '@deslop/runtime/shared/format'
import {TimeFrame} from '@deslop/runtime/shared/time'

import {ConnectionItem, McpUsageWindow, ServerId, failureMessage} from './contract.ts'
import type {McpUsageReport} from './contract.ts'

const ServersRead = AsyncResult.Schema({error: Schema.Unknown, success: Schema.Array(ConnectionItem)})
const McpUsageRead = AsyncResult.Schema({error: Schema.Unknown, success: McpUsageWindow})

export const connectionsFields = {mcpUsage: McpUsageRead, servers: ServersRead}
export const connectionsMessages = {
	McpUsage: {period: TimeFrame, result: McpUsageRead},
	Perform: {id: ServerId},
	Servers: {result: ServersRead}
}

function serverProblem(server: ConnectionItem) {
	if (server.status === 'Expired') return 'Authorization expired'
	return Option.match(server.error, {
		onNone: () => {
			if (server.status === 'Not connected') return 'Not connected'
			return undefined
		},
		onSome: failureMessage
	})
}

function urgency(server: ConnectionItem) {
	if (server.status === 'Expired' || Option.isSome(server.error)) return 0
	if (server.status === 'Not connected') return 1
	return 2
}

function callsLabel(calls: number) {
	const unit = Boolean.match(calls === 1, {onFalse: Function.constant('calls'), onTrue: Function.constant('call')})
	return `${countOf(calls)} ${unit}`
}

export type ServerRow = {readonly item: RowData; readonly id: ServerId; readonly action?: string}

export function serverRows(servers: readonly ConnectionItem[], usage: McpUsageReport): readonly ServerRow[] {
	const callsByServer = HashMap.fromIterable(
		Array.map(usage, entry => [entry.id, Number.sumAll(Array.map(entry.series, bucket => bucket.calls))] as const)
	)
	return pipe(
		servers,
		Array.sort(Order.mapInput(Order.Number, urgency)),
		Array.map(server => {
			const problem = serverProblem(server)
			if (problem !== undefined) {
				return {
					action: Boolean.match(server.status === 'Connected', {
						onFalse: Function.constant('Connect'),
						onTrue: Function.constant('Reconnect')
					}),
					id: server.id,
					item: {
						id: `server:${server.id}`,
						line: new URL(server.url).hostname,
						problem: {reason: problem, status: 'error' as const},
						title: server.name
					}
				}
			}
			return {
				id: server.id,
				item: {
					id: `server:${server.id}`,
					line: new URL(server.url).hostname,
					title: server.name,
					trailing: callsLabel(pipe(callsByServer, HashMap.get(server.id), Option.getOrElse(Function.constant(0))))
				}
			}
		})
	)
}
