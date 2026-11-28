import {Array, Boolean, Function, HashMap, Option, Result, Schema, pipe} from 'effect'

import {AsyncResult} from 'effect/reactivity'

import type {RowData} from '@deslop/components/model'

import {Entry} from '#reads'

import {AiKeyItem} from './contract.ts'
import type {AiProvider} from './contract.ts'

import type {AiUsageWindow, SpendSource} from '#ai-metering/contract.ts'
import {aiCost, aiSeries} from '#ai-metering/screen.ts'

const REFUSED_STATUSES = [401, 403]
const PROVIDER_ORDER: readonly AiProvider[] = ['opencode', 'anthropic', 'openai']
const PROVIDERS = {
	anthropic: {label: 'Anthropic key', name: 'Anthropic', payer: 'byok', prefix: 'sk-ant-'},
	openai: {label: 'OpenAI key', name: 'OpenAI', payer: 'openai', prefix: 'sk-'},
	opencode: {label: 'Zen balance', name: 'OpenCode', payer: 'balance', prefix: 'oc_'}
} satisfies Record<AiProvider, {label: string; name: string; payer: SpendSource; prefix: string}>

const KeysRead = AsyncResult.Schema({error: Schema.Unknown, success: Schema.Array(AiKeyItem)})
type KeysRead = typeof KeysRead.Type

// The keys, and the sheet that saves one.
export const aiProxyFields = {
	dialog: Schema.UndefinedOr(Schema.Struct({error: Schema.UndefinedOr(Schema.String), secret: Entry})),
	keys: KeysRead
}
export const aiProxyMessages = {CancelKey: {}, EditedKey: {secret: Entry}, Keys: {result: KeysRead}, SaveKey: {}}

export function credentialAction(keys: readonly AiKeyItem[], provider?: AiProvider) {
	if (provider === undefined) return 'Save key'
	const action = pipe(
		keys,
		Array.some(key => key.provider === provider),
		Boolean.match({onFalse: Function.constant('Save'), onTrue: Function.constant('Replace')})
	)
	return `${action} ${PROVIDERS[provider].name} key`
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
				const refused = Option.exists(key.lastStatus, status => Array.contains(REFUSED_STATUSES, status))
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
