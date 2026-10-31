import {Array, Predicate, String} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'

// no-restricted-imports keeps jsdom and happy-dom out of imports; a pragma or a test environment loads them without one.
const MESSAGE =
	'Tests run in Node without a DOM, under the environment the Vitest project sets; prove a screen in the browser.'

export const noDomTestEnvironment = defineRule({
	create: context => ({
		// Vitest reads the pragma anywhere in the file's text, comment or not.
		Program: () => {
			for (const pragma of String.matchAll(/@(?:vitest|jest)-environment\s+[\w-]+/gu)(context.sourceCode.text)) {
				context.report({loc: context.sourceCode.getLocFromIndex(pragma.index ?? 0), message: MESSAGE})
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
