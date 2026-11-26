import type {Html} from '@effect/ui/html'

import {Array, Boolean, Function, HashMap, Match, Number, Option, Order, Result, String, pipe} from 'effect'

import {countOf} from '@deslop/runtime/shared/format'
import {Button} from '@deslop/ui/control'

import {failureMessage} from '#contracts'
import type {AiKeyItem, AiProvider, AiUsageWindow, ConnectionItem, McpUsageReport, SpendSource} from '#contracts'

import anthropic from '#web/home/marks/anthropic.svg'
import openai from '#web/home/marks/openai.svg'
import opencode from '#web/home/marks/opencode.svg'
import {Action, Message} from '#web/home/model.ts'
import {aiCost, aiSeries} from '#web/home/usage.ts'

const PROVIDER_ORDER: readonly AiProvider[] = ['opencode', 'anthropic', 'openai']
const PROVIDERS = {
	anthropic: {label: 'Anthropic key', mark: anthropic, name: 'Anthropic', payer: 'byok', prefix: 'sk-ant-'},
	openai: {label: 'OpenAI key', mark: openai, name: 'OpenAI', payer: 'openai', prefix: 'sk-'},
	opencode: {label: 'Zen balance', mark: opencode, name: 'OpenCode', payer: 'balance', prefix: 'oc_'}
} satisfies Record<AiProvider, {label: string; mark: string; name: string; payer: SpendSource; prefix: string}>

type H = Html.H<Message>

export function credentialAction(secret: string, valid: boolean, keys: readonly AiKeyItem[]) {
	if (!valid) return 'Save key'
	const provider = pipe(
		secret,
		Match.value,
		Match.when(String.startsWith('oc_sk_'), Function.constant('opencode' as const)),
		Match.when(String.startsWith('sk-ant-'), Function.constant('anthropic' as const)),
		Match.orElse(Function.constant('openai' as const))
	)
	const action = pipe(
		keys,
		Array.some(key => key.provider === provider),
		Boolean.match({onFalse: Function.constant('Save'), onTrue: Function.constant('Replace')})
	)
	return `${action} ${PROVIDERS[provider].name} key`
}

function Lead(h: H, title: string, muted: string, problem?: string, mark?: string) {
	return h.div.class('gateway-lead').children(
		mark !== undefined && h.img.class('gateway-mark').attrs({alt: '', src: mark}),
		h.div.class('min-w-0').children(
			h.div
				.class('axis-title')
				.children(problem !== undefined && h.span.class('axis-dot').attr('aria-hidden', 'true'), title),
			h.div
				.class('axis-muted')
				.attr('title', problem)
				.children(
					Option.match(Option.fromUndefinedOr(problem), {
						onNone: Function.constant(muted),
						onSome: reason => `${reason} · ${muted}`
					})
				)
		)
	)
}

function Sparkline(h: H, values: readonly number[]) {
	const peak = Array.reduce(values, 0, Number.max)
	const width = Number.max(1, values.length - 1)
	const points = pipe(
		values,
		Array.map(
			(value, index) =>
				`${1 + (index * 98) / width},${Boolean.match(peak === 0, {
					onFalse: () => 15 - 14 * (value / peak),
					onTrue: Function.constant(15)
				})}`
		),
		Array.join(' ')
	)
	return h
		.el('svg')
		.attrs({'aria-hidden': 'true', class: 'gateway-trace', preserveAspectRatio: 'none', viewBox: '0 0 100 16'})
		.children(
			h
				.el('polyline')
				.attrs({
					fill: 'none',
					points,
					stroke: 'currentColor',
					'stroke-width': '1',
					'vector-effect': 'non-scaling-stroke'
				})
		)
}

export function KeyRows(h: Html.H<Message>, keys: readonly AiKeyItem[], usage: AiUsageWindow) {
	const byProvider = HashMap.fromIterable(Array.map(keys, key => [key.provider, key] as const))
	return Array.filterMap(PROVIDER_ORDER, provider =>
		pipe(
			byProvider,
			HashMap.get(provider),
			Result.fromOption(Function.constVoid),
			Result.map(key => {
				const style = PROVIDERS[provider]
				const problem = pipe(
					key.lastStatus,
					Option.filter(status => status === 401 || status === 403),
					Option.as('Key refused'),
					Option.getOrUndefined
				)
				return h.div
					.class('axis-row')
					.key(provider)
					.attr('role', 'listitem')
					.children(
						Lead(h, style.name, `${style.prefix}…${key.last4}`, problem, style.mark),
						h.div
							.class('gateway-figures')
							.children(
								Sparkline(h, aiSeries(usage.report, style.payer, usage.range)),
								h.div
									.class('axis-value')
									.children(aiCost(usage.report, style.payer), h.div.class('axis-muted').children(style.label))
							)
					)
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

function Calls(h: H, calls: number) {
	const unit = Boolean.match(calls === 1, {onFalse: Function.constant('calls'), onTrue: Function.constant('call')})
	return h.span.class('axis-value').children(`${countOf(calls)} ${unit}`)
}

function ConnectionAction(h: H, server: ConnectionItem, busy: boolean) {
	const action = Boolean.match(server.status === 'Connected', {
		onFalse: Function.constant('Connect'),
		onTrue: Function.constant('Reconnect')
	})
	return Button(h, {disabled: busy})
		.class('gateway-action')
		.attr('aria-label', `${action} ${server.name}`)
		.on('click', Message.Perform({action: Action.cases.Connect.make({id: server.id})}))
		.children(action)
}

export function ServerRows(
	h: Html.H<Message>,
	servers: readonly ConnectionItem[],
	usage: McpUsageReport,
	busy: boolean
) {
	const callsByServer = HashMap.fromIterable(
		Array.map(
			usage,
			entry =>
				[
					entry.id,
					pipe(
						entry.series,
						Array.map(bucket => bucket.calls),
						Number.sumAll
					)
				] as const
		)
	)
	return pipe(
		servers,
		Array.sort(Order.mapInput(Order.Number, urgency)),
		Array.map(server => {
			const problem = serverProblem(server)
			return h.div
				.class('axis-row')
				.key(server.id)
				.attr('role', 'listitem')
				.children(
					Lead(h, server.name, new URL(server.url).hostname, problem),
					Boolean.match(problem === undefined, {
						onFalse: () => ConnectionAction(h, server, busy),
						onTrue: () => Calls(h, pipe(callsByServer, HashMap.get(server.id), Option.getOrElse(Function.constant(0))))
					})
				)
		})
	)
}
