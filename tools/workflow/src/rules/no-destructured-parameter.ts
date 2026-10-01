import {Array} from 'effect'

import {defineRule} from '@oxlint/plugins'
import type {ESTree} from '@oxlint/plugins'

function isPattern(node: ESTree.ParamPattern | ESTree.BindingPattern) {
	const target = node.type === 'AssignmentPattern' ? node.left : node
	if (target.type === 'ArrayPattern') return true
	if (target.type !== 'ObjectPattern') return false
	const named = Array.filter(target.properties, property => property.type === 'Property')
	const onlyRef =
		named.length === 1 &&
		named[0]?.key.type === 'Identifier' &&
		named[0].key.name === 'ref' &&
		Array.some(target.properties, property => property.type === 'RestElement')
	return !onlyRef
}

export const noDestructuredParameter = defineRule({
	create: context => {
		function reportParameters(node: ESTree.Function | ESTree.ArrowFunctionExpression) {
			for (const parameter of Array.filter(node.params, isPattern)) {
				context.report({
					message: 'Take the value whole and read its fields instead of destructuring it.',
					node: parameter
				})
			}
		}
		function reportLoopVariable(node: ESTree.ForOfStatement | ESTree.ForInStatement) {
			if (
				node.left.type === 'VariableDeclaration' &&
				Array.some(node.left.declarations, declarator => isPattern(declarator.id))
			) {
				context.report({
					message: 'Take the value whole and read its fields instead of destructuring it.',
					node: node.left
				})
			}
		}
		return {
			ArrowFunctionExpression: reportParameters,
			ForInStatement: reportLoopVariable,
			ForOfStatement: reportLoopVariable,
			FunctionDeclaration: reportParameters,
			FunctionExpression: reportParameters
		}
	},
	meta: {type: 'problem'}
})
