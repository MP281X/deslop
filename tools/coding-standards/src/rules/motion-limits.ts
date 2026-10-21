import {Array, Number, Option, Predicate, String, pipe} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {Context, ESTree} from 'vite-plus/lint/plugins'

import {matches} from '#rules/shared.ts'

// A Tailwind class without its variants and important marker, such as `duration-500` from `hover:duration-500!`.
function utility(token: string) {
	return pipe(
		token,
		String.split(':'),
		Array.last,
		Option.getOrElse(() => token),
		String.replaceAll(/^!|!$/gu, '')
	)
}

function amount(token: string, pattern: RegExp) {
	return pipe(
		utility(token),
		String.match(pattern),
		Option.flatMap(match => Option.fromNullishOr(match[1])),
		Option.map(value =>
			pipe(
				Number.parse(value),
				Option.getOrElse(() => 0)
			)
		)
	)
}

function violation(token: string) {
	if (Option.exists(amount(token, /^duration-(\d+)$/u), value => value >= 300)) {
		return Option.some('Keep a tween under 300 ms, such as duration-200.')
	}
	if (
		matches(/^zoom-(?:in|out)$/u)(utility(token)) ||
		Option.exists(amount(token, /^zoom-(?:in|out)-(\d+)$/u), value => value < 90)
	) {
		return Option.some('Enter from 0.9 scale or more: zoom-in-90 or zoom-in-95.')
	}
	if (
		pipe(token, String.split(':'), Array.dropRight(1), Array.contains('starting')) &&
		Option.exists(amount(token, /^scale-(\d+)$/u), value => value < 90)
	) {
		return Option.some('Enter from 0.9 scale or more: starting:scale-90 or starting:scale-95.')
	}
	return Option.none()
}

function check(context: Context, node: ESTree.Node, text: string) {
	pipe(
		String.split(text, /\s+/u),
		Array.map(violation),
		Array.getSomes,
		Array.head,
		Option.map(message => context.report({message, node}))
	)
}

export const motionLimits = defineRule({
	create: context => ({
		Literal: node => {
			if (Predicate.isString(node.value)) check(context, node, node.value)
		},
		TemplateElement: node => {
			check(context, node, node.value.raw)
		}
	}),
	meta: {type: 'problem'}
})
