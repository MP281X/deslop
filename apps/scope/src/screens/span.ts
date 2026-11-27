import {Array, Boolean, Function, Option, Record, String, pipe} from 'effect'

import {clockOf, durationOf} from '@deslop/runtime/shared/format'

import {appName} from '#contracts'
import type {TraceSpan} from '#contracts'

import {attributesOf} from '#screens/selection.ts'

const STATUS: Record<string, string> = {
	400: 'Bad Request',
	401: 'Unauthorized',
	403: 'Forbidden',
	404: 'Not Found',
	407: 'Proxy Authentication Required',
	409: 'Conflict',
	422: 'Unprocessable Entity',
	429: 'Too Many Requests',
	500: 'Server Error',
	502: 'Bad Gateway',
	503: 'Unavailable',
	504: 'Gateway Timeout'
}

function urlLabel(url: URL) {
	return `${url.host}${url.pathname}`
}

function httpUrl(value: string) {
	if (!URL.canParse(value)) return undefined
	const url = new URL(value)
	if (url.protocol === 'http:' || url.protocol === 'https:') return url
	return undefined
}

function errorOf(message: string, denied: boolean) {
	return pipe(
		message,
		String.match(/^StatusCode error \((\d{3}) (\w+) (https?:\/\/[^\s)]+)\)$/u),
		Option.match({
			onNone: () => ({
				message,
				title: Boolean.match(denied, {onFalse: Function.constant('Error'), onTrue: Function.constant('Denied')})
			}),
			onSome: parts => {
				const address = parts[3] ?? ''
				const label = pipe(
					httpUrl(address),
					Option.fromUndefinedOr,
					Option.map(urlLabel),
					Option.getOrElse(() => address)
				)
				return {
					message: `${parts[2]} ${label} · ${parts[1]}`,
					title: pipe(
						STATUS,
						Record.get(parts[1] ?? ''),
						Option.getOrElse(() => `HTTP ${parts[1]}`)
					)
				}
			}
		})
	)
}

export function spanDetail(span: TraceSpan) {
	const failure = pipe(
		span.error,
		Option.orElse(() => span.exception),
		Option.map(message => errorOf(message, span.status === 'denied'))
	)
	const fields = Array.map(attributesOf(span), attribute => {
		if (attribute.key === 'url.full') {
			const url = httpUrl(attribute.value)
			if (url !== undefined) return {id: 'attribute:url.full', label: 'URL', url: url.href, value: urlLabel(url)}
		}
		return {id: `attribute:${attribute.key}`, label: attribute.key, value: attribute.value, url: undefined}
	})
	const source = appName(span.service)
	const line = `${source} · at ${durationOf(span.offsetMs)}`

	return {
		row: {
			id: 'span',
			line,
			...Boolean.match(span.status === 'failed', {
				onFalse: () => ({}),
				onTrue: () => ({problem: {reason: line, status: 'error'}}) as const
			}),
			title: span.name,
			trailing: durationOf(span.durationMs)
		},
		failure,
		fields,
		logs: Array.map(span.logs, log => ({
			id: `${log.id}`,
			failed: log.severity >= 17,
			text: log.message,
			time: clockOf(log.time, 'millisecond')
		}))
	}
}

export type SpanDetail = ReturnType<typeof spanDetail>
