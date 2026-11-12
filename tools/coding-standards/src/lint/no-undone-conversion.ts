import {Array} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {Context, ESTree} from 'vite-plus/lint/plugins'

import {composedSteps, matches} from '#lib/ast.ts'

// effecttsgo's global-json owns JSON.parse of JSON.stringify, and the restricted Number and String globals own their casts.
const OPTION_WRAPS = ['fromNullOr', 'fromNullishOr', 'fromUndefinedOr', 'some']
const OPTION_UNWRAPS = ['getOrElse', 'getOrNull', 'getOrUndefined']
const isDecode = matches(/^decode/u)
const isEncode = matches(/^encode/u)

function sameOperands(context: Context, left: ESTree.Node[], right: ESTree.Node[]) {
	return (
		Array.isReadonlyArrayNonEmpty(left) &&
		left.length === right.length &&
		Array.every(
			Array.zip(left, right),
			pair => context.sourceCode.getText(pair[0]) === context.sourceCode.getText(pair[1])
		)
	)
}

function message(context: Context, composition: ReturnType<typeof composedSteps>[number]) {
	const inner = `${composition.inner.module}.${composition.inner.name}`
	const outer = `${composition.outer.module}.${composition.outer.name}`
	if (
		composition.inner.module === 'Option' &&
		composition.outer.module === 'Option' &&
		Array.contains(OPTION_WRAPS, composition.inner.name) &&
		Array.contains(OPTION_UNWRAPS, composition.outer.name)
	) {
		return [`Use the value itself, with ?? for a fallback; ${outer} undoes ${inner}.`]
	}
	if (
		composition.inner.module === 'Schema' &&
		composition.outer.module === 'Schema' &&
		isEncode(composition.inner.name) &&
		isDecode(composition.outer.name) &&
		sameOperands(context, composition.inner.operands, composition.outer.operands)
	) {
		return [`Keep the value; ${outer} decodes what ${inner} just encoded with the same schema.`]
	}
	if (
		inner === 'Array.join' &&
		outer === 'String.split' &&
		sameOperands(context, composition.inner.operands, composition.outer.operands)
	) {
		return ['Keep the items; String.split takes apart what Array.join just joined with the same separator.']
	}
	return []
}

export const noUndoneConversion = defineRule({
	create: context => ({
		CallExpression: node => {
			for (const composition of composedSteps(context, node)) {
				for (const text of message(context, composition)) context.report({message: text, node: composition.report})
			}
		}
	}),
	meta: {type: 'problem'}
})
