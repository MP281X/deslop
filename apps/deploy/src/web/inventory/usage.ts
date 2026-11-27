import {Boolean, Function, Number, Option, String} from 'effect'

import {countOf, percentOf} from '@deslop/runtime/shared/format'

import type {H} from '#web/inventory/model.ts'
import {shown} from '#web/inventory/rows.ts'

const decimal = new Intl.NumberFormat('en', {maximumFractionDigits: 1})

function gib(bytes: number) {
	return decimal.format(bytes / 1024 ** 3)
}

export function Percent(h: H, value: Option.Option<number>) {
	return Option.match(value, {
		onNone: Function.constant('—'),
		onSome: cpu => [String.slice(0, -1)(percentOf(cpu)), h.small.children('%')]
	})
}

export function Memory(h: H, value: Option.Option<number>) {
	return Option.match(value, {
		onNone: Function.constant('—'),
		onSome: bytes => [countOf(bytes / 1024 ** 2), ' ', h.small.children('MiB')]
	})
}

export function UsageBar(h: H, value: Option.Option<number>, total: number) {
	const ratio = Boolean.match(total > 0, {
		onFalse: Function.constant(0),
		onTrue: () => (100 * Option.getOrElse(value, Function.constant(0))) / total
	})
	return h.span
		.class('deploy-usage-bar')
		.attr('aria-hidden', 'true')
		.children(h.span.style({width: `${Number.clamp(ratio, {maximum: 100, minimum: 0})}%`}))
}

export function Capacity(h: H, label: string, used: Option.Option<number>, total: Option.Option<number>) {
	return h.span
		.class('min-w-0')
		.children(
			h.span.class('deploy-caption block').children(label),
			h.span.class('deploy-numeral text-[15px]').children(shown(used, gib)),
			h.span.class('deploy-caption whitespace-nowrap').children(' / ', shown(total, gib), ' GiB'),
			UsageBar(h, used, Option.getOrElse(total, Function.constant(0)))
		)
}
