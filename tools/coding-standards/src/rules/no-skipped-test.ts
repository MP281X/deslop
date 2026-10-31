import {Array, Option} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {Context, ESTree} from 'vite-plus/lint/plugins'

import {hasEffectMember, isFunction, optionKeys, testChain} from '#rules/shared.ts'

const MESSAGE = 'Run every test: remove this .only, .skip, .skipIf, .runIf or .fails before committing.'

// vitest/no-focused-tests and no-disabled-tests read it.only and it.skip, not @effect/vitest's it.effect.only, a layer's test.skip, a condition or an options object.
function skips(context: Context, node: ESTree.MemberExpression) {
	return Option.exists(testChain(context, node), chain =>
		Option.exists(Array.last(chain.members), last => {
			if (Array.contains(['fails', 'runIf', 'skipIf'], last)) return true
			// The native rules read any root named it, test or describe, a layer's parameter included, but no @effect/vitest member.
			return (
				Array.contains(['only', 'skip'], last) &&
				(!Array.contains(['describe', 'it', 'suite', 'test'], chain.root.name) || hasEffectMember(chain.members))
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
