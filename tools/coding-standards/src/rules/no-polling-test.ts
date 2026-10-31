import {Array, Option, Predicate} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {Context, ESTree} from 'vite-plus/lint/plugins'

import {containsNode, importedMember, isClockWait, isTestFile, memberName, optionKeys} from '#rules/shared.ts'

const MESSAGE =
	'This test polls until a condition holds, which passes or fails with the scheduler and the load: await the Deferred, Latch, Queue, Stream element or Machine.waitFor that marks the milestone.'

type Loop = ESTree.DoWhileStatement | ESTree.ForStatement | ESTree.WhileStatement

// A clock wait, a yield to the scheduler, or an awaited tick such as `await Promise.resolve()`.
function isWait(context: Context, node: ESTree.Node) {
	if (isClockWait(context, node)) return true
	if (node.type === 'MemberExpression') {
		return importedMember({context, importedName: 'Effect', node, propertyName: 'yieldNow'})
	}
	return (
		node.type === 'AwaitExpression' &&
		node.argument.type === 'CallExpression' &&
		node.argument.callee.type === 'MemberExpression' &&
		node.argument.callee.object.type === 'Identifier' &&
		node.argument.callee.object.name === 'Promise' &&
		Option.contains(memberName(node.argument.callee), 'resolve')
	)
}

function exits(node: ESTree.Node) {
	return Array.contains(['BreakStatement', 'ReturnStatement', 'ThrowStatement'], node.type)
}

function advances(node: ESTree.Node, counter: string) {
	return (
		(node.type === 'UpdateExpression' && node.argument.type === 'Identifier' && node.argument.name === counter) ||
		(node.type === 'AssignmentExpression' &&
			(node.operator === '+=' || node.operator === '-=') &&
			node.left.type === 'Identifier' &&
			node.left.name === counter)
	)
}

// `i < 3` that the loop itself advances bounds it without asking the system under test anything.
function countsTo(context: Context, loop: Loop) {
	if (Predicate.isNullish(loop.test) || loop.test.type !== 'BinaryExpression') return false
	if (!Array.contains(['<', '<=', '>', '>='], loop.test.operator)) return false
	return Array.some([loop.test.left, loop.test.right], counter => {
		if (counter.type !== 'Identifier') return false
		return (
			containsNode({
				context,
				matches: node => advances(node, counter.name),
				node: loop.body,
				throughFunctions: false
			}) ||
			(loop.type === 'ForStatement' &&
				Predicate.isNotNullish(loop.update) &&
				containsNode({
					context,
					matches: node => advances(node, counter.name),
					node: loop.update,
					throughFunctions: false
				}))
		)
	})
}

function isPipe(node: ESTree.CallExpression) {
	return (
		(node.callee.type === 'Identifier' && node.callee.name === 'pipe') ||
		(node.callee.type === 'MemberExpression' && Option.contains(memberName(node.callee), 'pipe'))
	)
}

// A data-last step such as `pipe(check, Effect.repeat({until}))` repeats what the pipe passes it.
function pipedFrom(node: ESTree.CallExpression) {
	if (
		node.parent.type === 'CallExpression' &&
		Array.some(node.parent.arguments, argument => argument === node) &&
		isPipe(node.parent)
	) {
		return node.parent
	}
	return node
}

// `{until}` or `{while}` without `times` repeats until the system under test changes, like a loop with no counter.
function untilUnbounded(argument: ESTree.Node) {
	const keys = optionKeys(argument)
	return (Array.contains(keys, 'until') || Array.contains(keys, 'while')) && !Array.contains(keys, 'times')
}

// A loop polls when a condition about the outside world ends it: a conditional exit in its body, or a test other than `true` or a counter.
function polls(context: Context, loop: Loop) {
	return (
		containsNode({
			context,
			matches: node =>
				node.type === 'IfStatement' && containsNode({context, matches: exits, node, throughFunctions: false}),
			node: loop.body,
			throughFunctions: false
		}) ||
		(Predicate.isNotNullish(loop.test) &&
			!(loop.test.type === 'Literal' && loop.test.value === true) &&
			!countsTo(context, loop))
	)
}

export const noPollingTest = defineRule({
	create: context => {
		if (!isTestFile(context)) return {}
		function loop(node: Loop) {
			if (
				containsNode({context, matches: child => isWait(context, child), node: node.body, throughFunctions: false}) &&
				polls(context, node)
			) {
				context.report({message: MESSAGE, node})
			}
		}
		return {
			CallExpression: node => {
				if (node.callee.type !== 'MemberExpression') return
				const callee = node.callee
				if (importedMember({context, importedName: 'Effect', node: callee, propertyName: 'eventually'})) {
					context.report({message: MESSAGE, node})
					return
				}
				if (
					Array.some(['repeat', 'repeatOrElse', 'retry', 'retryOrElse'], propertyName =>
						importedMember({context, importedName: 'Effect', node: callee, propertyName})
					) &&
					(containsNode({
						context,
						matches: child => isWait(context, child),
						node: pipedFrom(node),
						throughFunctions: true
					}) ||
						Array.some(node.arguments, untilUnbounded))
				) {
					context.report({message: MESSAGE, node})
				}
			},
			DoWhileStatement: loop,
			ForStatement: loop,
			WhileStatement: loop
		}
	},
	meta: {type: 'problem'}
})
