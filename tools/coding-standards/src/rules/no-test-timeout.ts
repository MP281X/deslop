import {Array, Option} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {Context, ESTree} from 'vite-plus/lint/plugins'

import {
	importedMember,
	isFunction,
	isImportBinding,
	isTestFile,
	optionKeys,
	resolveBinding,
	testChain,
	testHook
} from '#rules/shared.ts'

const TIMEOUT =
	"Keep the project's testTimeout as the only limit: a per-test timeout or retry hides a wait that should await its milestone. A slow suite goes in a *.slow.test.ts file, which runs with the slow project's limit."
const HANG_GUARD =
	"Drop this timeout: the project's testTimeout already ends a hang, and on the TestClock it fires only when the test moves time."
const FLAKY = 'Fix the flaky test instead of retrying it.'

// Anything after the body (a function, or a call such as `Effect.fnUntraced(…)` that builds one) is its timeout or options; options before it, inline or bound to a constant, may set a timeout, retries or repeats.
function setsLimit(context: Context, node: ESTree.CallExpression) {
	const body = Array.findFirstIndex(
		node.arguments,
		(argument, index) => isFunction(argument) || (index > 0 && argument.type === 'CallExpression')
	)
	return Array.some(
		node.arguments,
		(argument, index) =>
			Option.exists(body, position => index > position) ||
			Array.some(optionKeys(resolveBinding(context, argument)), key =>
				Array.contains(['repeats', 'retry', 'timeout'], key)
			)
	)
}

export const noTestTimeout = defineRule({
	create: context => {
		if (!isTestFile(context)) return {}
		return {
			CallExpression: node => {
				if (
					(testHook(context, node.callee) || Option.isSome(testChain(context, node.callee))) &&
					setsLimit(context, node)
				) {
					context.report({message: TIMEOUT, node})
				}
				if (
					node.callee.type === 'Identifier' &&
					isImportBinding({context, importedName: 'flakyTest', node: node.callee, source: '@effect/vitest'})
				) {
					context.report({message: FLAKY, node})
				}
			},
			MemberExpression: node => {
				if (
					Array.some(['timeout', 'timeoutOption', 'timeoutOrElse'], propertyName =>
						importedMember({context, importedName: 'Effect', node, propertyName})
					)
				) {
					context.report({message: HANG_GUARD, node})
					return
				}
				if (Option.exists(testChain(context, node), chain => Option.contains(Array.last(chain.members), 'flakyTest'))) {
					context.report({message: FLAKY, node})
				}
			}
		}
	},
	meta: {type: 'problem'}
})
