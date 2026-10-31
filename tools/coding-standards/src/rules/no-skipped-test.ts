import {Array, Option} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {Context, ESTree} from 'vite-plus/lint/plugins'

import {isFunction, optionKeys, testChain} from '#rules/shared.ts'

const MESSAGE = 'Run every test: remove this .only, .skip, .skipIf, .runIf or .fails before committing.'

// vitest/no-focused-tests and no-disabled-tests read it.only and it.skip, not @effect/vitest's it.effect.only, test.scoped.skip inside it.layer, a condition or an options object.
function skips(context: Context, node: ESTree.MemberExpression) {
	return Option.exists(testChain(context, node), chain =>
		Option.exists(Array.last(chain.members), last => {
			if (Array.contains(['fails', 'runIf', 'skipIf'], last)) return true
			return (
				Array.contains(['only', 'skip'], last) &&
				Array.some(Array.dropRight(chain.members, 1), member =>
					Array.contains(['effect', 'live', 'prop', 'scoped', 'scopedLive'], member)
				)
			)
		})
	)
}

export const noSkippedTest = defineRule({
	create: context => ({
		CallExpression: node => {
			if (
				Array.some(node.arguments, isFunction) &&
				Option.isSome(testChain(context, node.callee)) &&
				Array.some(node.arguments, argument =>
					Array.some(optionKeys(argument), key => Array.contains(['fails', 'only', 'skip', 'todo'], key))
				)
			) {
				context.report({message: MESSAGE, node})
			}
		},
		MemberExpression: node => {
			if (skips(context, node)) context.report({message: MESSAGE, node: node.property})
		}
	}),
	meta: {type: 'problem'}
})
