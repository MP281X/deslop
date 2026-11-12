import {Array} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {Context, ESTree} from 'vite-plus/lint/plugins'

import {containsNode, isFunction} from '#lib/ast.ts'

// A call, a write or a fresh function can give two writings of one expression different values.
const UNSTABLE = [
	'AssignmentExpression',
	'AwaitExpression',
	'CallExpression',
	'ClassExpression',
	'ImportExpression',
	'NewExpression',
	'TaggedTemplateExpression',
	'UpdateExpression',
	'YieldExpression'
]

function stable(context: Context, node: ESTree.Node) {
	return !containsNode({
		context,
		matches: inner => isFunction(inner) || Array.contains(UNSTABLE, inner.type),
		node,
		throughFunctions: false
	})
}

// eslint's no-self-compare owns `x === x`; the preset bans expect, so assert is the only assertion API.
export const noSelfComparingAssertion = defineRule({
	create: context => ({
		CallExpression: node => {
			const [actual, expected] = node.arguments
			if (
				node.callee.type !== 'MemberExpression' ||
				node.callee.object.type !== 'Identifier' ||
				node.callee.object.name !== 'assert' ||
				actual === undefined ||
				expected === undefined ||
				context.sourceCode.getText(actual) !== context.sourceCode.getText(expected) ||
				!stable(context, actual)
			) {
				return
			}
			context.report({
				message:
					'Compare the result with the expected value; an expression asserted against itself gives the same verdict whatever the code does.',
				node
			})
		}
	}),
	meta: {type: 'problem'}
})
