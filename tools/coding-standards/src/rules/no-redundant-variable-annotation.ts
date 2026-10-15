import {Array, Predicate} from 'effect'

import {defineRule} from '@oxlint/plugins'

export const noRedundantVariableAnnotation = defineRule({
	create: context => ({
		VariableDeclarator: node => {
			if (node.init === null || Predicate.isNullish(node.id.typeAnnotation)) return
			if (node.init.type === 'ArrayExpression' && Array.isArrayEmpty(node.init.elements)) {
				context.report({
					message: 'Write Array.empty<T>() instead of annotating an empty array.',
					node: node.id.typeAnnotation
				})
				return
			}
			if (
				node.init.type === 'TSAsExpression' &&
				context.sourceCode.getText(node.init.typeAnnotation) ===
					context.sourceCode.getText(node.id.typeAnnotation.typeAnnotation)
			) {
				context.report({message: 'Drop this annotation; inference gives the same type.', node: node.id.typeAnnotation})
			}
		}
	}),
	meta: {type: 'problem'}
})
