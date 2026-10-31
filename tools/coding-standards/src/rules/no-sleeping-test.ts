import {Array, MutableList} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {ESTree} from 'vite-plus/lint/plugins'

import {containsNode, isClockWait, isTestClockCall, isTestFile, isTimerCall, onRealClock} from '#rules/shared.ts'

const REAL_CLOCK =
	'This test waits on the real clock: await the Deferred, Latch, Queue or Stream element that marks the milestone, or move time with TestClock.adjust under it.effect.'
const UNDRIVEN =
	'Nothing in this file moves the TestClock, so this wait ends only at the test timeout: move time with TestClock.adjust, or await the milestone.'

export const noSleepingTest = defineRule({
	create: context => {
		if (!isTestFile(context)) return {}
		const testClockWaits = MutableList.make<ESTree.Node>()
		return {
			// The Effect compiler's globalTimers diagnostic owns the global setTimeout and setInterval.
			CallExpression: node => {
				if (isTimerCall(context, node) && node.callee.type === 'Identifier' && node.callee.name === 'setImmediate') {
					context.report({message: REAL_CLOCK, node})
				}
			},
			ImportDeclaration: node => {
				if (Array.contains(['node:timers', 'node:timers/promises', 'timers', 'timers/promises'], node.source.value)) {
					context.report({message: REAL_CLOCK, node})
				}
			},
			MemberExpression: node => {
				if (!isClockWait(context, node)) return
				if (onRealClock(context, node)) {
					context.report({message: REAL_CLOCK, node})
					return
				}
				MutableList.append(testClockWaits, node)
			},
			'Program:exit': program => {
				if (
					containsNode({
						context,
						matches: node => isTestClockCall(context, node, 'adjust') || isTestClockCall(context, node, 'setTime'),
						node: program,
						throughFunctions: true
					})
				) {
					return
				}
				for (const node of MutableList.toArray(testClockWaits)) context.report({message: UNDRIVEN, node})
			}
		}
	},
	meta: {type: 'problem'}
})
