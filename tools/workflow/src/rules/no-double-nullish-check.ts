import {Array, Option} from 'effect'

import {defineRule} from '@oxlint/plugins'
import type {Context, ESTree} from '@oxlint/plugins'

function nullishOperand(node: ESTree.Expression) {
	if (node.type === 'Literal' && node.value === null) return Option.some('null')
	return node.type === 'Identifier' && node.name === 'undefined' ? Option.some('undefined') : Option.none()
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
			const operator = node.operator === '&&' ? '!==' : '==='
			const sides = Array.getSomes([
				comparedNullish({context, node: node.left, operator}),
				comparedNullish({context, node: node.right, operator})
			])
			const [left, right] = sides
			if (left === undefined || right === undefined) return
			if (left.subject !== right.subject || left.nullish === right.nullish) return
			context.report({message: operator === '!==' ? 'Use Predicate.isNotNullish.' : 'Use Predicate.isNullish.', node})
		}
	}),
	meta: {type: 'problem'}
})
