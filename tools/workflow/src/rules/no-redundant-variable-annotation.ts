import {Array, Predicate} from 'effect'

import {defineRule} from '@oxlint/plugins'
import type {Context, ESTree} from '@oxlint/plugins'

function isStringLiteral(node: ESTree.Expression) {
	return node.type === 'Literal' && Predicate.isString(node.value)
}

function inferredIdentically(input: {context: Context; init: ESTree.Expression; type: ESTree.TSType}) {
	const text = input.context.sourceCode.getText
	if (input.init.type === 'TSAsExpression') return text(input.init.typeAnnotation) === text(input.type)
	if (input.init.type === 'ArrayExpression') {
		return (
			input.type.type === 'TSArrayType' &&
			input.init.elements.length === 1 &&
			input.init.elements[0]?.type === 'SpreadElement'
		)
	}
	return (
		input.init.type === 'ConditionalExpression' &&
		input.type.type === 'TSStringKeyword' &&
		isStringLiteral(input.init.consequent) &&
		isStringLiteral(input.init.alternate)
	)
}

export const noRedundantVariableAnnotation = defineRule({
	create: context => ({
		VariableDeclarator: node => {
			const annotation = node.id.typeAnnotation
			if (node.init === null || Predicate.isNullish(annotation)) return
			if (node.init.type === 'ArrayExpression' && Array.isArrayEmpty(node.init.elements)) {
				context.report({message: 'Write Array.empty<T>() instead of annotating an empty array.', node: annotation})
				return
			}
			if (inferredIdentically({context, init: node.init, type: annotation.typeAnnotation})) {
				context.report({message: 'Drop this annotation; inference gives the same type.', node: annotation})
			}
		}
	}),
	meta: {type: 'problem'}
})
