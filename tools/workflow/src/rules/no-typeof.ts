import {defineRule} from '@oxlint/plugins'

export const noTypeof = defineRule({
	create: context => ({
		UnaryExpression: node => {
			if (node.operator === 'typeof') {
				context.report({message: 'Replace typeof with a Predicate guard such as Predicate.isString.', node})
			}
		}
	}),
	meta: {type: 'problem'}
})
