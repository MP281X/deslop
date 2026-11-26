import type {Html} from '@effect/ui/html'

import {Array, Boolean, Function, Option, Record, String, pipe} from 'effect'

import {clockOf} from '@deslop/runtime/shared/format'

import {appName} from '#contracts'
import type {TraceSpan} from '#contracts'

import {attributesOf} from '#web/telemetry/selection.ts'

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

function errorOf(message: string, denied: boolean) {
	return pipe(
		message,
		String.match(/^StatusCode error \((\d{3}) (\w+) (https?:\/\/[^\s)]+)\)$/u),
		Option.match({
			onNone: () => ({
				message,
				title: Boolean.match(denied, {onFalse: Function.constant('Error'), onTrue: Function.constant('Denied')})
			}),
			onSome: parts => ({
				message: `${parts[2]} ${String.replace(/^https?:\/\//u, '')(parts[3] ?? '')} · ${parts[1]}`,
				title: pipe(
					STATUS,
					Record.get(parts[1] ?? ''),
					Option.getOrElse(() => `HTTP ${parts[1]}`)
				)
			})
		})
	)
}

function field<M>(h: Html.H<M>, key: string, label: string, value: string, href?: string) {
	return h.div
		.key(key)
		.class('scope-field')
		.children(
			h.dt.class('axis-muted').children(label),
			h.dd.children(
				Option.match(Option.fromUndefinedOr(href), {
					onNone: () => value,
					onSome: url =>
						h.a
							.attr('href', url)
							.attr('target', '_blank')
							.attr('rel', 'noreferrer')
							.class('underline underline-offset-2')
							.children(value)
				})
			)
		)
}

export function SpanDetail<M>(h: Html.H<M>, span: TraceSpan) {
	const failure = pipe(
		span.error,
		Option.orElse(() => span.exception),
		Option.map(message => errorOf(message, span.status === 'denied'))
	)
	return h.section
		.class('scope-diagnostics')
		.attr('aria-label', 'Span details')
		.children(
			Option.match(failure, {
				onNone: Function.constUndefined,
				onSome: error =>
					h.div
						.class('scope-diagnostic-message')
						.children(h.p.class('axis-title').children(error.title), h.p.class('axis-muted').children(error.message))
			}),
			h.dl.children(
				field(h, 'source', 'Source', appName(span.service)),
				Array.map(attributesOf(span), attribute => {
					if (attribute.key === 'url.full' && String.startsWith('https://')(attribute.value)) {
						return field(h, 'attribute:url.full', attribute.key, attribute.value, attribute.value)
					}
					return field(h, `attribute:${attribute.key}`, attribute.key, attribute.value)
				})
			),
			Array.isReadonlyArrayNonEmpty(span.logs) &&
				h.ol
					.class('scope-logs')
					.attr('aria-label', 'Span logs')
					.children(
						Array.map(span.logs, log =>
							h.li
								.key(`${log.id}`)
								.class('scope-log')
								.children(
									h.time.class('axis-muted').children(clockOf(log.time, 'millisecond')),
									h.pre.class(log.severity >= 17 && 'text-destructive').children(log.message)
								)
						)
					)
		)
}
