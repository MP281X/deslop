import {Array, Boolean, MutableList, Option, Predicate} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {Context, ESTree} from 'vite-plus/lint/plugins'

import {
	containsNode,
	effectMethod,
	importedMember,
	isClockWait,
	isFunction,
	isImportBinding,
	isTestClockCall,
	isTestFile,
	isTimerCall,
	memberName,
	onRealClock,
	optionKeys,
	resolveBinding,
	testChain,
	testHook
} from '#lib/ast.ts'

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
function untilUnbounded(context: Context, argument: ESTree.Node) {
	const keys = optionKeys(resolveBinding(context, argument))
	return (Array.contains(keys, 'until') || Array.contains(keys, 'while')) && !Array.contains(keys, 'times')
}

// Repeating Queue.take waits for each element, which is the milestone the message asks for.
function takesEvents(context: Context, node: ESTree.Node) {
	return containsNode({
		context,
		matches: child =>
			child.type === 'MemberExpression' &&
			Array.some(['take', 'takeAll', 'takeN'], propertyName =>
				importedMember({context, importedName: 'Queue', node: child, propertyName})
			),
		node,
		throughFunctions: true
	})
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

function setsLimit(context: Context, node: ESTree.CallExpression) {
	const body = Array.findFirstIndex(
		node.arguments,
		(argument, index) =>
			isFunction(resolveBinding(context, argument)) || (index > 0 && argument.type === 'CallExpression')
	)
	return Array.some(node.arguments, (argument, index) => {
		const value = resolveBinding(context, argument)
		if (value.type === 'ObjectExpression') {
			return Array.some(optionKeys(value), key => Array.contains(['repeats', 'retry', 'timeout'], key))
		}
		return Option.exists(body, position => index > position)
	})
}

function inside(node: ESTree.Node, ancestor: ESTree.Node): boolean {
	if (node === ancestor) return true
	if (node.parent === null) return false
	return inside(node.parent, ancestor)
}

function assertionIn(context: Context, node: ESTree.Node, seen: ESTree.Node[] = []): boolean {
	if (Array.contains(seen, node)) return false
	return containsNode({
		context,
		matches: child => {
			const bound = resolveBinding(context, child)
			if (bound !== child && bound.type === 'CallExpression') return assertionIn(context, bound, [...seen, node])
			return (
				child.type === 'CallExpression' &&
				child.callee.type === 'MemberExpression' &&
				child.callee.object.type === 'Identifier' &&
				isImportBinding({context, importedName: 'assert', node: child.callee.object, source: '@effect/vitest'})
			)
		},
		node: resolveBinding(context, node),
		throughFunctions: true
	})
}

export const testSynchronization = defineRule({
	create: context => {
		if (!isTestFile(context)) return {}
		const waits = MutableList.make<ESTree.Node>()
		const findings = MutableList.make<{message: string; node: ESTree.Node}>()
		function loop(node: Loop) {
			if (
				containsNode({context, matches: child => isWait(context, child), node: node.body, throughFunctions: false}) &&
				polls(context, node)
			) {
				MutableList.append(findings, {message: MESSAGE, node})
			}
		}
		return {
			CallExpression: node => {
				if (
					((testHook(context, node.callee) || Option.isSome(testChain(context, node.callee))) &&
						setsLimit(context, node)) ||
					(node.callee.type === 'Identifier' &&
						isImportBinding({context, importedName: 'flakyTest', node: node.callee, source: '@effect/vitest'}))
				) {
					MutableList.append(findings, {
						message:
							'Use the project timeout only; await a milestone or advance TestClock instead of per-test limits or retries.',
						node
					})
					return
				}
				if (isTimerCall(context, node) && node.callee.type === 'Identifier' && node.callee.name === 'setImmediate') {
					MutableList.append(findings, {message: MESSAGE, node})
				}
				const method = effectMethod({context, node})
				if (
					Option.exists(method, name =>
						Array.contains(['retry', 'retryOrElse', 'repeat', 'repeatOrElse', 'schedule'], name)
					) &&
					assertionIn(context, pipedFrom(node))
				) {
					MutableList.append(findings, {
						message:
							'Run each assertion once. Exercise retries in the service under test and assert its final answer after a milestone or TestClock adjustment.',
						node
					})
					return
				}
				if (Option.contains(method, 'eventually')) {
					MutableList.append(findings, {message: MESSAGE, node})
					return
				}
				if (
					Option.exists(method, name => Array.contains(['repeat', 'repeatOrElse', 'retry', 'retryOrElse'], name)) &&
					(containsNode({
						context,
						matches: child => isWait(context, child),
						node: pipedFrom(node),
						throughFunctions: true
					}) ||
						(Array.some(node.arguments, argument => untilUnbounded(context, argument)) &&
							!takesEvents(context, pipedFrom(node))))
				) {
					MutableList.append(findings, {message: MESSAGE, node})
				}
			},
			DoWhileStatement: loop,
			ForStatement: loop,
			ImportDeclaration: node => {
				if (Array.contains(['node:timers', 'node:timers/promises', 'timers', 'timers/promises'], node.source.value)) {
					MutableList.append(findings, {message: MESSAGE, node})
				}
			},
			MemberExpression: node => {
				if (isClockWait(context, node)) {
					if (onRealClock(context, node)) MutableList.append(findings, {message: MESSAGE, node})
					else MutableList.append(waits, node)
					return
				}
				if (
					Array.some(['timeout', 'timeoutOption', 'timeoutOrElse'], propertyName =>
						importedMember({context, importedName: 'Effect', node, propertyName})
					) ||
					Option.exists(testChain(context, node), chain => Option.contains(Array.last(chain.members), 'flakyTest'))
				) {
					MutableList.append(findings, {
						message:
							'Use the project timeout only; await a milestone or advance TestClock instead of adding hang guards or flaky retries.',
						node
					})
				}
			},
			'Program:exit': program => {
				const all = Array.appendAll(
					MutableList.toArray(findings),
					Boolean.match(
						containsNode({
							context,
							matches: node => isTestClockCall(context, node, 'adjust') || isTestClockCall(context, node, 'setTime'),
							node: program,
							throughFunctions: true
						}),
						{
							onFalse: () =>
								Array.map(MutableList.toArray(waits), node => ({
									message:
										'Advance TestClock for time-dependent logic, or await its Deferred, Latch, Queue or Stream milestone.',
									node
								})),
							onTrue: Array.empty
						}
					)
				)
				for (const finding of all) {
					if (!Array.some(all, other => other.node !== finding.node && inside(finding.node, other.node))) {
						context.report(finding)
					}
				}
			},
			WhileStatement: loop
		}
	},
	meta: {
		docs: {
			examples: {
				accepted: [
					{
						'sample.test.ts': `import {assert, it} from '@effect/vitest'
import {Effect, Fiber, pipe} from 'effect'
import {TestClock} from 'effect/testing'
it.effect('expires after the lease duration', Effect.fnUntraced(function* () {
const lease = yield* pipe(Effect.succeed('expired'), Effect.delay('1 second'), Effect.forkChild)
yield* TestClock.adjust('1 second')
assert.strictEqual(yield* Fiber.join(lease), 'expired')
}))`
					}
				]
			}
		},
		type: 'problem'
	}
})
