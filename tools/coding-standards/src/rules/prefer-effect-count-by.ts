import {Option} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {ESTree} from 'vite-plus/lint/plugins'

import {isFilteredCount, lengthTest} from '#rules/shared.ts'

// `filtered.length === 0` and `filtered.length > 0` ask whether anything matches, not how many do.
function testsPresence(node: ESTree.MemberExpression) {
	return node.parent.type === 'BinaryExpression' && node.parent.left === node && Option.isSome(lengthTest(node.parent))
}

export const preferEffectCountBy = defineRule({
	create: context => ({
		MemberExpression: node => {
			if (!isFilteredCount({context, node})) return
			if (testsPresence(node)) {
				context.report({message: 'Test for a match with Array.some; no filtered array is consumed.', node})
				return
			}
			context.report({message: 'Count matches with Array.countBy; no filtered array is consumed.', node})
		}
	}),
	meta: {type: 'problem'}
})
