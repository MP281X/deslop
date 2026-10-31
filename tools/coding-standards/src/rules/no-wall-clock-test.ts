import {Array, Option, String} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {Context, ESTree} from 'vite-plus/lint/plugins'

import {importedMember, isTestFile, memberName, onRealClock, variableFor} from '#rules/shared.ts'

const MESSAGE =
	'This test reads the real time, so its result depends on when and how fast it runs: use a fixed instant with TestClock.setTime, and Clock or DateTime under it.effect.'

// The Effect compiler's globalDate diagnostic owns Date.now() and new Date().
const WALL_CLOCKS = ['Date', 'performance.now', 'process.hrtime', 'process.hrtime.bigint']

// The dotted path of a call on a global such as `process.hrtime.bigint`.
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

export const noWallClockTest = defineRule({
	create: context => {
		if (!isTestFile(context)) return {}
		return {
			CallExpression: node => {
				if (Option.exists(globalPath(context, node.callee), path => Array.contains(WALL_CLOCKS, path))) {
					context.report({message: MESSAGE, node})
				}
			},
			MemberExpression: node => {
				if (readsRealTime(context, node)) context.report({message: MESSAGE, node})
			}
		}
	},
	meta: {type: 'problem'}
})
