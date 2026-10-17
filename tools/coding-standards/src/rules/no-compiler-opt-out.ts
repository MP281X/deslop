import {defineRule} from '@oxlint/plugins'

export const noCompilerOptOut = defineRule({
	create: context => ({
		ExpressionStatement: node => {
			if (node.directive !== 'use no memo' && node.directive !== 'use no forget') return
			context.report({message: 'Remove this directive, rerun lint and fix the React Compiler diagnostic it hid.', node})
		}
	}),
	meta: {type: 'problem'}
})
