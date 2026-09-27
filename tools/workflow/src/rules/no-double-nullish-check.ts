import {Array, Option, Result, pipe} from 'effect'

import {defineRule} from '@oxlint/plugins'
import type {Context, ESTree} from '@oxlint/plugins'

function nullishOperand(node: ESTree.Expression) {
	if (node.type === 'Literal' && node.value === null) return Option.some('null')
	return node.type === 'Identifier' && node.name === 'undefined' ? Option.some('undefined') : Option.none()
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
			const comparison = node.operator === '&&' ? '!==' : '==='
			const checks = pipe(
				operands({node, operator: node.operator}),
				Array.filterMap(operand =>
					Result.fromOption(comparedNullish({context, node: operand, operator: comparison}), () => undefined)
				)
			)
			const doubled = Array.some(checks, check =>
				Array.some(checks, other => other.subject === check.subject && other.nullish !== check.nullish)
			)
			if (doubled) {
				context.report({
					message: comparison === '!==' ? 'Use Predicate.isNotNullish.' : 'Use Predicate.isNullish.',
					node
				})
			}
		}
	}),
	meta: {type: 'problem'}
})
