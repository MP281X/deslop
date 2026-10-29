import {defineRule} from 'vite-plus/lint/plugins'

// No fix: `in` narrows a union by its members and Predicate.hasProperty does not, so a mechanical swap breaks the code that reads the narrowed value.
export const noInOperator = defineRule({
	create: context => ({
		BinaryExpression: node => {
			if (node.operator !== 'in') return
			context.report({
				message: 'Decode the value with Schema, or narrow it with Predicate.hasProperty, instead of the in operator.',
				node
			})
		}
	}),
	meta: {type: 'problem'}
})
