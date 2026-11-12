import {Array, Option, Predicate} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {Context, ESTree} from 'vite-plus/lint/plugins'

import {childNodes, isFunction, matches} from '#lib/ast.ts'

const MESSAGE = 'An is, has, can or should name promises a boolean; rename it to say what it holds, or make it one.'
const NON_BOOLEAN_OPERATORS = ['%', '&', '*', '**', '+', '-', '/', '<<', '>>', '>>>', '^', '|']
const NON_BOOLEAN_NODES = [
	'ArrayExpression',
	'ClassExpression',
	'JSXElement',
	'JSXFragment',
	'NewExpression',
	'ObjectExpression',
	'TemplateLiteral',
	'UpdateExpression'
]
const isBooleanName = matches(/^(?:is|has|can|should)[A-Z0-9]/u)

// Only what syntax shows to be no boolean; a call, a read or `null` stays with review.
function nonBoolean(node: ESTree.Node) {
	if (node.type === 'Literal') return node.value !== null && !Predicate.isBoolean(node.value)
	if (node.type === 'BinaryExpression') return Array.contains(NON_BOOLEAN_OPERATORS, node.operator)
	if (node.type === 'UnaryExpression') return Array.contains(['+', '-', 'typeof', '~'], node.operator)
	return Array.contains(NON_BOOLEAN_NODES, node.type)
}

// The values a function returns from its own body, not from the functions inside it.
function returnedValues(context: Context, node: ESTree.Node): ESTree.Node[] {
	if (node.type === 'ReturnStatement') return Option.toArray(Option.fromNullishOr(node.argument))
	if (isFunction(node)) return []
	return Array.flatMap(childNodes(context, node), child => returnedValues(context, child))
}

function returnsNonBoolean(context: Context, node: ESTree.Function | ESTree.ArrowFunctionExpression) {
	if (node.generator || node.body === null) return false
	if (node.body.type !== 'BlockStatement') return nonBoolean(node.body)
	return Array.some(
		Array.flatMap(node.body.body, statement => returnedValues(context, statement)),
		nonBoolean
	)
}

export const noMisleadingBooleanName = defineRule({
	create: context => ({
		FunctionDeclaration: node => {
			if (node.id !== null && isBooleanName(node.id.name) && returnsNonBoolean(context, node)) {
				context.report({message: MESSAGE, node: node.id})
			}
		},
		VariableDeclarator: node => {
			if (node.id.type !== 'Identifier' || !isBooleanName(node.id.name) || node.init === null) return
			if (
				nonBoolean(node.init) ||
				((node.init.type === 'ArrowFunctionExpression' || node.init.type === 'FunctionExpression') &&
					returnsNonBoolean(context, node.init))
			) {
				context.report({message: MESSAGE, node: node.id})
			}
		}
	}),
	meta: {type: 'problem'}
})
