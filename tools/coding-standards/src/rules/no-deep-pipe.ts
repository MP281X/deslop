import {Array} from 'effect'

import {defineRule} from '@oxlint/plugins'
import type {Context, ESTree} from '@oxlint/plugins'

import {isImportBinding} from '#rules/shared.ts'

function isPipeCall(context: Context, node: ESTree.Node): node is ESTree.CallExpression {
	return (
		node.type === 'CallExpression' &&
		node.callee.type === 'Identifier' &&
		isImportBinding({context, importedName: 'pipe', node: node.callee, source: 'effect'})
	)
}

function enclosingPipes(context: Context, node: ESTree.Node): number {
	if (
		node.type === 'Program' ||
		Array.contains(['ArrowFunctionExpression', 'FunctionDeclaration', 'FunctionExpression'], node.type)
	) {
		return 0
	}
	return (
		enclosingPipes(context, node.parent) +
		(isPipeCall(context, node.parent) && Array.some(node.parent.arguments, argument => argument === node) ? 1 : 0)
	)
}

export const noDeepPipe = defineRule({
	create: context => ({
		CallExpression: node => {
			if (isPipeCall(context, node) && enclosingPipes(context, node) >= 3) {
				context.report({message: 'Flatten this pipeline; pipe calls nest at most three deep.', node})
			}
		}
	}),
	meta: {type: 'problem'}
})
