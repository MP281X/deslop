import {Array, Option} from 'effect'

import {defineRule} from '@oxlint/plugins'
import type {Context, ESTree} from '@oxlint/plugins'

import {isImportBinding, isNamespaceImport, memberName} from './shared.ts'

function isReactUseRef(input: {context: Context; node: ESTree.CallExpression}) {
	if (input.node.callee.type === 'Identifier') {
		return isImportBinding({context: input.context, importedName: 'useRef', node: input.node.callee, source: 'react'})
	}
	return (
		input.node.callee.type === 'MemberExpression' &&
		Option.contains(memberName(input.node.callee), 'useRef') &&
		input.node.callee.object.type === 'Identifier' &&
		isNamespaceImport({context: input.context, node: input.node.callee.object, source: 'react'})
	)
}

function redundantUseRefNullType(input: {context: Context; node: ESTree.CallExpression}) {
	const type = input.node.typeArguments?.params[0]
	return (
		isReactUseRef(input) &&
		input.node.arguments[0]?.type === 'Literal' &&
		input.node.arguments[0].value === null &&
		type?.type === 'TSUnionType' &&
		Array.some(type.types, member => member.type === 'TSNullKeyword')
	)
}

export const noRedundantUseRefNullType = defineRule({
	create: context => ({
		CallExpression: node => {
			if (redundantUseRefNullType({context, node})) {
				context.report({
					message: 'Remove null from the explicit useRef type; the null initializer already owns it.',
					node
				})
			}
		}
	}),
	meta: {type: 'problem'}
})
