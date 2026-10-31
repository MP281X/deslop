import {Array, Predicate} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'

import {matches} from '#rules/shared.ts'

// no-restricted-imports keeps jsdom and happy-dom out of imports; a pragma or a test environment loads them without one.
const MESSAGE = 'Prove a screen in the browser; tests run in Node without a DOM.'

export const noDomTestEnvironment = defineRule({
	create: context => ({
		Program: () => {
			for (const comment of context.sourceCode.getAllComments()) {
				if (matches(/@vitest-environment\b/u)(comment.value)) context.report({message: MESSAGE, node: comment})
			}
		},
		Property: node => {
			if (
				!node.computed &&
				node.key.type === 'Identifier' &&
				node.key.name === 'environment' &&
				node.value.type === 'Literal' &&
				Predicate.isString(node.value.value) &&
				Array.contains(['happy-dom', 'jsdom'], node.value.value)
			) {
				context.report({message: MESSAGE, node})
			}
		}
	}),
	meta: {type: 'problem'}
})
