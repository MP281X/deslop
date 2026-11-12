import {Array, Option, String} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {Context, ESTree} from 'vite-plus/lint/plugins'

import {importedMember, isFunction, isTestFile, memberName, onRealClock, variableFor} from '#lib/ast.ts'

const MESSAGE =
	'This test reads the real time, so its result depends on when and how fast it runs: use a fixed instant with TestClock.setTime, and Clock or DateTime under it.effect.'
const EFFECT_MESSAGE =
	'This wall-clock read bypasses the Effect Clock: use Clock.currentTimeMillis, with Stream.mapEffect for a stream callback.'

// In tests, the Effect compiler's globalDate diagnostic owns Date.now() and new Date().
const WALL_CLOCKS = ['Date', 'performance.now', 'process.hrtime', 'process.hrtime.bigint']

function globalPath(context: Context, node: ESTree.Expression | ESTree.Super): Option.Option<string> {
	if (node.type === 'Identifier') {
		return Option.liftPredicate(
			node.name,
			() => !Option.exists(variableFor(context, node), variable => Array.isArrayNonEmpty(variable.defs))
		)
	}
	if (node.type !== 'MemberExpression') return Option.none()
	return Option.flatMap(memberName(node), name =>
		Option.map(globalPath(context, node.object), path => `${path}.${name}`)
	)
}

// A read of Clock or DateTime.now that runs on the real clock, or DateTime.nowUnsafe, which reads it anywhere.
function readsRealTime(context: Context, node: ESTree.MemberExpression) {
	if (importedMember({context, importedName: 'DateTime', node, propertyName: 'nowUnsafe'})) return true
	return (
		(importedMember({context, importedName: 'Clock', node}) ||
			(importedMember({context, importedName: 'DateTime', node}) &&
				Option.exists(memberName(node), String.startsWith('now')))) &&
		onRealClock(context, node)
	)
}

function effectCallback(context: Context, node: ESTree.Node): boolean {
	if (node.parent === null) return false
	// Options such as Effect.tryPromise({try: () => …}) also run their callbacks inside Effect.
	if (node.parent.type === 'Property' && node.parent.value === node && node.parent.parent.type === 'ObjectExpression') {
		return effectCallback(context, node.parent.parent)
	}
	if (node.parent.type !== 'CallExpression' || !Array.some(node.parent.arguments, argument => argument === node)) {
		return false
	}
	if (
		importedMember({context, importedName: 'Effect', node: node.parent.callee}) ||
		importedMember({context, importedName: 'Stream', node: node.parent.callee})
	) {
		return true
	}
	return (
		node.parent.callee.type === 'CallExpression' &&
		node.parent.callee.callee.type === 'MemberExpression' &&
		importedMember({context, importedName: 'Effect', node: node.parent.callee.callee}) &&
		Option.exists(memberName(node.parent.callee.callee), name => Array.contains(['fn', 'fnUntraced'], name))
	)
}

// Stop at the nearest function: an event handler or a plain helper nested in a generator is not its execution body.
function insideEffect(context: Context, node: ESTree.Node): boolean {
	if (isFunction(node)) return effectCallback(context, node)
	if (node.parent === null) return false
	return insideEffect(context, node.parent)
}

export const noWallClockTest = defineRule({
	create: context => {
		const testFile = isTestFile(context)
		return {
			CallExpression: node => {
				if (testFile) {
					if (Option.exists(globalPath(context, node.callee), path => Array.contains(WALL_CLOCKS, path))) {
						context.report({message: MESSAGE, node})
					}
					return
				}
				if (
					(Option.contains(globalPath(context, node.callee), 'Date.now') ||
						importedMember({context, importedName: 'DateTime', node: node.callee, propertyName: 'nowUnsafe'})) &&
					insideEffect(context, node)
				) {
					context.report({message: EFFECT_MESSAGE, node})
				}
			},
			MemberExpression: node => {
				if (testFile && readsRealTime(context, node)) context.report({message: MESSAGE, node})
			},
			NewExpression: node => {
				if (
					!testFile &&
					Array.isArrayEmpty(node.arguments) &&
					Option.contains(globalPath(context, node.callee), 'Date') &&
					insideEffect(context, node)
				) {
					context.report({message: EFFECT_MESSAGE, node})
				}
			}
		}
	},
	meta: {type: 'problem'}
})
