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
	"Keep the project's testTimeout and hookTimeout as the only limits: a per-test timeout or retry hides a wait that should await its milestone, and a slow test needs a smaller scenario, such as one that starts from a saved state."
const HANG_GUARD =
	"Drop this timeout: the project's testTimeout already ends a hang, and on the TestClock it fires only when the test moves time."
const FLAKY = 'Fix the flaky test instead of retrying it.'

// The body is a function, inline or bound to a constant, or a call such as `Effect.fnUntraced(…)` that builds one. After it, any value but an options object is a timeout; an options object anywhere, inline or bound to a constant, may set a timeout, retries or repeats.
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
