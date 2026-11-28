import {Array, Boolean, Function, HashMap, Number, Option, Order, Result, pipe} from 'effect'

import type {RowData} from '@deslop/components/model'
import {countOf} from '@deslop/runtime/shared/format'

import {failureMessage} from '#contracts'
import type {
	AiKeyItem,
	AiProvider,
	AiUsageWindow,
	ConnectionItem,
	McpUsageReport,
	ServerId,
	SpendSource
} from '#contracts'

import {aiCost, aiSeries} from '#screens/usage.ts'

const PROVIDER_ORDER: readonly AiProvider[] = ['opencode', 'anthropic', 'openai']
const PROVIDERS = {
	anthropic: {label: 'Anthropic key', name: 'Anthropic', payer: 'byok', prefix: 'sk-ant-'},
	openai: {label: 'OpenAI key', name: 'OpenAI', payer: 'openai', prefix: 'sk-'},
	opencode: {label: 'Zen balance', name: 'OpenCode', payer: 'balance', prefix: 'oc_'}
} satisfies Record<AiProvider, {label: string; name: string; payer: SpendSource; prefix: string}>

export function credentialAction(keys: readonly AiKeyItem[], provider?: AiProvider) {
	if (provider === undefined) return 'Save key'
	const action = pipe(
		keys,
		Array.some(key => key.provider === provider),
		Boolean.match({onFalse: Function.constant('Save'), onTrue: Function.constant('Replace')})
	)
	return `${action} ${PROVIDERS[provider].name} key`
}

export const TRACE_WIDTH = 50
export const TRACE_HEIGHT = 16

export function tracePoints(values: readonly number[]) {
	const peak = Array.reduce(values, 0, Number.max)
	const width = Number.max(1, values.length - 1)
	return Array.map(values, (value, index) => ({
		x: 1 + (index * (TRACE_WIDTH - 2)) / width,
		y: Boolean.match(peak === 0, {
			onFalse: () => TRACE_HEIGHT - 1 - (TRACE_HEIGHT - 2) * (value / peak),
			onTrue: Function.constant(TRACE_HEIGHT - 1)
		})
	}))
}

export type KeyRow = {
	readonly item: RowData
	readonly provider: AiProvider
	readonly label: string
	readonly value: string
	readonly values: readonly number[]
}

export function keyRows(keys: readonly AiKeyItem[], usage: AiUsageWindow): readonly KeyRow[] {
	const byProvider = HashMap.fromIterable(Array.map(keys, key => [key.provider, key] as const))
	return Array.filterMap(PROVIDER_ORDER, provider =>
		pipe(
			byProvider,
			HashMap.get(provider),
			Result.fromOption(Function.constVoid),
			Result.map(key => {
				const providerDetails = PROVIDERS[provider]
				const refused = Option.exists(key.lastStatus, status => status === 401 || status === 403)
				const masked = `${providerDetails.prefix}…${key.last4}`
				return {
					item: {
						id: `key:${provider}`,
						line: masked,
						problem: Boolean.match(refused, {
							onFalse: Function.constUndefined,
							onTrue: () => ({reason: `Key refused · ${masked}`, status: 'error' as const})
						}),
						title: providerDetails.name
					},
					label: providerDetails.label,
					provider,
					value: aiCost(usage.report, providerDetails.payer),
					values: aiSeries(usage.report, providerDetails.payer, usage.range)
				}
			})
		)
	)
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
