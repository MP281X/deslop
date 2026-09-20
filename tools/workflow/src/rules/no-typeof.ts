import {defineRule} from '@oxlint/plugins'

export const noTypeof = defineRule({
	create: context => ({
		UnaryExpression: node => {
			if (node.operator === 'typeof') context.report({message: 'Use a Predicate module function.', node})
		}
	}),
	meta: {type: 'problem'}
})
