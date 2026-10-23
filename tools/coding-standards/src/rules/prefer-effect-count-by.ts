import {defineRule} from 'vite-plus/lint/plugins'

import {isFilteredCount} from '#rules/shared.ts'

export const preferEffectCountBy = defineRule({
	create: context => ({
		MemberExpression: node => {
			if (!isFilteredCount({context, node})) return
			context.report({message: 'Count matches with Array.countBy; no filtered array is consumed.', node})
		}
	}),
	meta: {type: 'problem'}
})
