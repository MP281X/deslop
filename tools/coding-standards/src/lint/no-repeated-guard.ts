import {Array, Option, pipe} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {Context, ESTree} from 'vite-plus/lint/plugins'

import {containsNode, isFunction} from '#lib/ast.ts'

// What can change a value between two checks, or give one written expression two values.
const CHANGES = [
	'AssignmentExpression',
	'AwaitExpression',
	'CallExpression',
	'ImportExpression',
	'NewExpression',
	'TaggedTemplateExpression',
	'UpdateExpression',
	'YieldExpression'
]
const EXITS = ['BreakStatement', 'ContinueStatement', 'ReturnStatement', 'ThrowStatement']

function changes(input: {context: Context; node: ESTree.Node; throughFunctions: boolean}) {
	return containsNode({
		...input,
		matches: node =>
			Array.contains(CHANGES, node.type) ||
			(node.type === 'UnaryExpression' && node.operator === 'delete') ||
			(input.throughFunctions && isFunction(node))
	})
}

function exits(statement: ESTree.Statement): boolean {
	if (Array.contains(EXITS, statement.type)) return true
	return statement.type === 'BlockStatement' && Option.exists(Array.last(statement.body), exits)
}

// An if with no else that exits on a test that changes nothing: the code after it runs only when the test is false.
function isGuard(context: Context, statement: ESTree.Statement): statement is ESTree.IfStatement {
	return (
		statement.type === 'IfStatement' &&
		statement.alternate === null &&
		exits(statement.consequent) &&
		!changes({context, node: statement.test, throughFunctions: true})
	)
}

// The nearest earlier guard with the same test, unless a statement between them can change what it reads.
function repeatsGuard(context: Context, body: ESTree.Statement[], index: number) {
	const statement = body[index]
	if (statement?.type !== 'IfStatement') return false
	const test = context.sourceCode.getText(statement.test)
	function sameGuard(previous: ESTree.Statement) {
		return isGuard(context, previous) && context.sourceCode.getText(previous.test) === test
	}
	return pipe(
		Array.reverse(Array.take(body, index)),
		Array.findFirst(
			previous =>
				sameGuard(previous) ||
				(!isGuard(context, previous) && changes({context, node: previous, throughFunctions: false}))
		),
		Option.exists(sameGuard)
	)
}

// typescript/no-unnecessary-condition owns a check the compiler narrows away; this owns a repeated test it cannot narrow, such as a comparison.
export const noRepeatedGuard = defineRule({
	create: context => ({
		BlockStatement: node => {
			Array.forEach(node.body, (statement, index) => {
				if (statement.type === 'IfStatement' && repeatsGuard(context, node.body, index)) {
					context.report({
						message:
							'Delete the check; an earlier guard with the same test already exited, and nothing since changed what it reads.',
						node: statement.test
					})
				}
			})
		}
	}),
	meta: {type: 'problem'}
})
