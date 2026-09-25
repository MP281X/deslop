import {Option} from 'effect'

import {defineRule} from '@oxlint/plugins'
import type {ESTree} from '@oxlint/plugins'

import {memberName} from './shared.ts'

function emptinessPredicate(node: ESTree.BinaryExpression) {
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
			const predicate = emptinessPredicate(node)
			if (Option.isSome(predicate)) context.report({message: `Use ${predicate.value}.`, node})
		}
	}),
	meta: {type: 'problem'}
})
