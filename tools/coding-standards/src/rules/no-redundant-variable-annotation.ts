import {Array, Predicate} from 'effect'

import {defineRule} from '@oxlint/plugins'

export const noRedundantVariableAnnotation = defineRule({
	create: context => ({
		VariableDeclarator: node => {
			if (node.init?.type !== 'ArrayExpression' || Predicate.isNullish(node.id.typeAnnotation)) return
			if (!Array.isArrayEmpty(node.init.elements)) return
			context.report({
				message: 'Write Array.empty<T>() instead of annotating an empty array.',
				node: node.id.typeAnnotation
			})
		}
	}),
	meta: {type: 'problem'}
})
