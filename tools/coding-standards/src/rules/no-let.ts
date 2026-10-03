import {defineRule} from '@oxlint/plugins'

export const noLet = defineRule({
	create: context => ({
		VariableDeclaration: node => {
			if (node.kind === 'let') {
				context.report({message: 'Replace let with a const pipeline or a fold such as Array.reduce.', node})
			}
		}
	}),
	meta: {type: 'problem'}
})
