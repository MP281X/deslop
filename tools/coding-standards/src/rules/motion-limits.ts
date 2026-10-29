import {Array, Number, Option, Predicate, String, pipe} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {Context, ESTree} from 'vite-plus/lint/plugins'

import {matches} from '#rules/shared.ts'

// Every limited utility names one of these, so other strings skip the per-token parse.
const MOTION_UTILITY = /duration-|zoom-|scale-/u

function amount(token: string, pattern: RegExp) {
	return pipe(
		token,
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
	const name = pipe(
		token,
		String.split(':'),
		Array.last,
		Option.getOrElse(() => token),
		String.replaceAll(/^!|!$/gu, '')
	)
	if (Option.exists(amount(name, /^duration-(\d+)$/u), value => value >= 300)) {
		return Option.some('Keep a tween under 300 ms, such as duration-200.')
	}
	if (
		matches(/^zoom-(?:in|out)$/u)(name) ||
		Option.exists(amount(name, /^zoom-(?:in|out)-(\d+)$/u), value => value < 90)
	) {
		return Option.some('Enter from 0.9 scale or more: zoom-in-90 or zoom-in-95.')
	}
	if (
		pipe(token, String.split(':'), Array.dropRight(1), Array.contains('starting')) &&
		Option.exists(amount(name, /^scale-(\d+)$/u), value => value < 90)
	) {
		return Option.some('Enter from 0.9 scale or more: starting:scale-90 or starting:scale-95.')
	}
	return Option.none()
}

function check(context: Context, node: ESTree.Node, text: string) {
	if (!MOTION_UTILITY.test(text)) return
	pipe(
		String.split(text, /\s+/u),
		Array.findFirst(violation),
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
