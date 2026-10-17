import {defineRule} from '@oxlint/plugins'

export const noCompilerOptOut = defineRule({
	create: context => ({
		ExpressionStatement: node => {
			if (node.directive !== 'use no memo' && node.directive !== 'use no forget') return
			context.report({
				message: 'Fix the code React Compiler rejects instead of opting the function out of compilation.',
				node
			})
		}
	}),
	meta: {type: 'problem'}
})
