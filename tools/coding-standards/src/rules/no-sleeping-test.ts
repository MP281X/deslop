import {MutableList} from 'effect'

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
		function wait(node: ESTree.Node) {
			if (!isClockWait(context, node)) return
			if (isTimerCall(context, node) || onRealClock(context, node)) {
				context.report({message: REAL_CLOCK, node})
				return
			}
			MutableList.append(testClockWaits, node)
		}
		return {
			CallExpression: wait,
			ImportDeclaration: node => {
				if (node.source.value === 'node:timers/promises' || node.source.value === 'timers/promises') {
					context.report({message: REAL_CLOCK, node})
				}
			},
			MemberExpression: wait,
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
