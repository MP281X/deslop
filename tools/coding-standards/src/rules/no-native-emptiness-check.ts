import {Option} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'

import {isFilteredCount, lengthTest, memberName} from '#rules/shared.ts'

const PREDICATES = {
	empty:
		'Array.isArrayEmpty for a mutable array, Array.isReadonlyArrayEmpty for a readonly one, String.isEmpty for a string',
	nonEmpty:
		'Array.isArrayNonEmpty for a mutable array, Array.isReadonlyArrayNonEmpty for a readonly one, String.isNonEmpty for a string'
}

export const noNativeEmptinessCheck = defineRule({
	create: context => ({
		BinaryExpression: node => {
			if (
				node.left.type !== 'MemberExpression' ||
				!Option.contains(memberName(node.left), 'length') ||
				isFilteredCount({context, node: node.left})
			) {
				return
			}
			Option.map(lengthTest(node), test => {
				context.report({message: `Use ${PREDICATES[test]}.`, node})
			})
		}
	}),
	meta: {type: 'problem'}
})
