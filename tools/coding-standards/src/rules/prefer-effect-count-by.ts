import {Option} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'

import {isFilteredCount, lengthTest} from '#rules/shared.ts'

export const preferEffectCountBy = defineRule({
	create: context => ({
		MemberExpression: node => {
			if (!isFilteredCount({context, node})) return
			// `filtered.length === 0` and `filtered.length > 0` ask whether anything matches, not how many do.
			if (
				node.parent.type === 'BinaryExpression' &&
				node.parent.left === node &&
				Option.isSome(lengthTest(node.parent))
			) {
				context.report({message: 'Test for a match with Array.some; no filtered array is consumed.', node})
				return
			}
			context.report({message: 'Count matches with Array.countBy; no filtered array is consumed.', node})
		}
	}),
	meta: {type: 'problem'}
})
