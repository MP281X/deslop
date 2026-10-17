import {Array, Option, Result, pipe} from 'effect'

import {defineRule} from '@oxlint/plugins'
import type {Context, ESTree} from '@oxlint/plugins'

const VARIANTS = {
	'&&': {comparison: '!==', message: 'Use Predicate.isNotNullish.'},
	'||': {comparison: '===', message: 'Use Predicate.isNullish.'}
} as const

function nullishOperand(node: ESTree.Expression) {
	if (node.type === 'Literal' && node.value === null) return Option.some('null')
	if (node.type === 'Identifier' && node.name === 'undefined') return Option.some('undefined')
	return Option.none()
}

function operands(input: {node: ESTree.Expression; operator: '&&' | '||'}): ESTree.Expression[] {
	if (input.node.type !== 'LogicalExpression' || input.node.operator !== input.operator) return [input.node]
	return Array.appendAll(
		operands({node: input.node.left, operator: input.operator}),
		operands({node: input.node.right, operator: input.operator})
	)
}

function comparedNullish(input: {context: Context; node: ESTree.Expression; operator: '!==' | '==='}) {
	if (input.node.type !== 'BinaryExpression' || input.node.operator !== input.operator) return Option.none()
	const subject = input.context.sourceCode.getText(input.node.left)
	return Option.map(nullishOperand(input.node.right), nullish => ({nullish, subject}))
}

export const noDoubleNullishCheck = defineRule({
	create: context => ({
		LogicalExpression: node => {
			if (node.operator === '??') return
			if (node.parent.type === 'LogicalExpression' && node.parent.operator === node.operator) return
			const variant = VARIANTS[node.operator]
			const checks = pipe(
				operands({node, operator: node.operator}),
				Array.filterMap(operand =>
					Result.fromOption(comparedNullish({context, node: operand, operator: variant.comparison}), () => undefined)
				)
			)
			const doubled = Array.some(checks, check =>
				Array.some(checks, other => other.subject === check.subject && other.nullish !== check.nullish)
			)
			if (doubled) context.report({message: variant.message, node})
		}
	}),
	meta: {type: 'problem'}
})
