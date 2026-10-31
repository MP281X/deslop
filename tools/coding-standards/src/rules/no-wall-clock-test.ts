import {Array, Option, pipe} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {Context, ESTree} from 'vite-plus/lint/plugins'

import {importedMember, isTestClockCall, isTestFile, memberName, variableFor} from '#rules/shared.ts'

const MESSAGE =
	'This test reads the real time, so its result depends on when and how fast it runs: use a fixed instant with TestClock.setTime, and Clock or DateTime under it.effect.'

const WALL_CLOCKS = ['Date.now', 'performance.now', 'process.hrtime', 'process.hrtime.bigint']

function isGlobal(context: Context, node: ESTree.IdentifierReference) {
	return !Option.exists(variableFor(context, node), variable => Array.isArrayNonEmpty(variable.defs))
}

// The dotted path of a call on a global such as `process.hrtime.bigint`.
function globalPath(context: Context, node: ESTree.Expression | ESTree.Super): Option.Option<string> {
	if (node.type === 'Identifier') return Option.liftPredicate(node.name, () => isGlobal(context, node))
	if (node.type !== 'MemberExpression') return Option.none()
	return Option.flatMap(memberName(node), name =>
		Option.map(globalPath(context, node.object), path => `${path}.${name}`)
	)
}

// `TestClock.withLive(Clock.currentTimeMillis)` measures the runner's clock.
function readsLiveTime(context: Context, node: ESTree.CallExpression) {
	return (
		isTestClockCall(context, node, 'withLive') &&
		pipe(
			Array.get(node.arguments, 0),
			Option.exists(
				argument =>
					argument.type === 'MemberExpression' &&
					(importedMember({context, importedName: 'Clock', node: argument}) ||
						importedMember({context, importedName: 'DateTime', node: argument}))
			)
		)
	)
}

export const noWallClockTest = defineRule({
	create: context => {
		if (!isTestFile(context)) return {}
		return {
			CallExpression: node => {
				if (
					Option.exists(globalPath(context, node.callee), path => Array.contains(WALL_CLOCKS, path)) ||
					readsLiveTime(context, node)
				) {
					context.report({message: MESSAGE, node})
				}
			},
			NewExpression: node => {
				if (
					Array.isArrayEmpty(node.arguments) &&
					node.callee.type === 'Identifier' &&
					node.callee.name === 'Date' &&
					isGlobal(context, node.callee)
				) {
					context.report({message: MESSAGE, node})
				}
			}
		}
	},
	meta: {type: 'problem'}
})
