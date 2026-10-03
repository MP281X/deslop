import {Array} from 'effect'

import {defineRule} from '@oxlint/plugins'
import type {ESTree} from '@oxlint/plugins'

function isPipeCall(node: ESTree.Node): node is ESTree.CallExpression {
	return node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'pipe'
}

function enclosingPipes(node: ESTree.Node): number {
	if (
		node.type === 'Program' ||
		Array.contains(['ArrowFunctionExpression', 'FunctionDeclaration', 'FunctionExpression'], node.type)
	) {
		return 0
	}
	const nested = isPipeCall(node.parent) && Array.some(node.parent.arguments, argument => argument === node)
	return enclosingPipes(node.parent) + (nested ? 1 : 0)
}

export const noDeepPipe = defineRule({
	create: context => ({
		CallExpression: node => {
			if (isPipeCall(node) && enclosingPipes(node) >= 3) {
				context.report({message: 'Flatten this pipeline; pipe calls nest at most three deep.', node})
			}
		}
	}),
	meta: {type: 'problem'}
})
