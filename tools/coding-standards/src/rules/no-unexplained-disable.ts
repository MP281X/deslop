import {defineRule} from '@oxlint/plugins'

import {matches} from '#rules/shared.ts'

export const noUnexplainedDisable = defineRule({
	create: context => ({
		Program: () => {
			for (const comment of context.sourceCode.getAllComments()) {
				if (matches(/^\s*(?:eslint|oxlint)-disable\S*\s(?:(?!\s--\s).)*\bsort-keys\b/u)(comment.value)) {
					context.report({
						message: 'Sort the keys, starting a new sorted group after a blank line; never disable sort-keys.',
						node: comment
					})
				} else if (
					matches(/^\s*(?:eslint-disable|oxlint-disable|@effect-diagnostics)/u)(comment.value) &&
					!matches(/\s--\s*\S/u)(comment.value)
				) {
					context.report({message: 'Give this disable a `-- reason`.', node: comment})
				}
			}
		}
	}),
	meta: {type: 'problem'}
})
