import {defineRule} from '@oxlint/plugins'

export const noUnexplainedDisable = defineRule({
	create: context => ({
		Program: () => {
			for (const comment of context.sourceCode.getAllComments()) {
				if (
					/^\s*(?:eslint-disable|oxlint-disable|@effect-diagnostics)/u.test(comment.value) &&
					!/\s--\s*\S/u.test(comment.value)
				) {
					context.report({message: 'Give this disable a `-- reason`.', node: comment})
				}
			}
		}
	}),
	meta: {type: 'problem'}
})
