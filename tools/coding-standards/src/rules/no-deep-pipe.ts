import {Array, Boolean} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {Context, ESTree} from 'vite-plus/lint/plugins'

import {childNodes, isImportBinding} from '#rules/shared.ts'

const FUNCTIONS = ['ArrowFunctionExpression', 'FunctionDeclaration', 'FunctionExpression']
const MAX_ENCLOSING_PIPES = 2

function isPipeCall(context: Context, node: ESTree.Node): node is ESTree.CallExpression {
	return (
		node.type === 'CallExpression' &&
		node.callee.type === 'Identifier' &&
		isImportBinding({context, importedName: 'pipe', node: node.callee, source: 'effect'})
	)
}

function pipeArgument(input: {child: ESTree.Node; context: Context; parent: ESTree.Node}) {
	return (
		isPipeCall(input.context, input.parent) && Array.some(input.parent.arguments, argument => argument === input.child)
	)
}

function enclosingPipes(context: Context, node: ESTree.Node): number {
	if (node.type === 'Program' || Array.contains(FUNCTIONS, node.type)) return 0
	const depth = enclosingPipes(context, node.parent)
	if (pipeArgument({child: node, context, parent: node.parent})) return depth + 1
	return depth
}

// How many pipes enclose each pipe call inside `node` once `node` stands where `enclosing` pipes enclose it.
function pipeDepths(input: {context: Context; enclosing: number; node: ESTree.Node}): number[] {
	if (Array.contains(FUNCTIONS, input.node.type)) return []
	const nested = Array.flatMap(childNodes(input.node), child =>
		pipeDepths({
			context: input.context,
			enclosing: Boolean.match(pipeArgument({child, context: input.context, parent: input.node}), {
				onFalse: () => input.enclosing,
				onTrue: () => input.enclosing + 1
			}),
			node: child
		})
	)
	if (isPipeCall(input.context, input.node)) return Array.prepend(nested, input.enclosing)
	return nested
}

// no-single-use-value moves a value into its read only when no pipe in the value ends up nested too deep.
export function nestsTooDeep(input: {context: Context; read: ESTree.Node; value: ESTree.Node}) {
	return Array.some(
		pipeDepths({context: input.context, enclosing: enclosingPipes(input.context, input.read), node: input.value}),
		depth => depth > MAX_ENCLOSING_PIPES
	)
}

export const noDeepPipe = defineRule({
	create: context => ({
		CallExpression: node => {
			if (isPipeCall(context, node) && enclosingPipes(context, node) > MAX_ENCLOSING_PIPES) {
				context.report({
					message:
						'Merge this pipe into its parent, or move it into a named function declaration; pipe calls nest at most three deep.',
					node
				})
			}
		}
	}),
	meta: {type: 'problem'}
})
