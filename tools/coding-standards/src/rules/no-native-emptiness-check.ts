import {Option} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {Context, ESTree} from 'vite-plus/lint/plugins'

import {isFilteredCount, memberName} from '#rules/shared.ts'

function emptinessPredicate(context: Context, node: ESTree.BinaryExpression) {
	if (isFilteredCount({context, node: node.left})) return Option.none()
	const comparesLength =
		node.left.type === 'MemberExpression' &&
		Option.contains(memberName(node.left), 'length') &&
		node.right.type === 'Literal' &&
		node.right.value === 0
	if (comparesLength && node.operator === '===') {
		return Option.some('Array.isArrayEmpty, Array.isReadonlyArrayEmpty, or String.isEmpty')
	}
	if (comparesLength && node.operator === '>') {
		return Option.some('Array.isArrayNonEmpty, Array.isReadonlyArrayNonEmpty, or String.isNonEmpty')
	}
	return Option.none()
}

export const noNativeEmptinessCheck = defineRule({
	create: context => ({
		BinaryExpression: node => {
			Option.map(emptinessPredicate(context, node), predicate => {
				context.report({message: `Use ${predicate}.`, node})
			})
		}
	}),
	meta: {type: 'problem'}
})
