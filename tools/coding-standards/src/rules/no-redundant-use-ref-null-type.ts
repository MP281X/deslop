import {Array, Function, Option, pipe} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {Context, ESTree, Fixer} from 'vite-plus/lint/plugins'

import {isImportBinding, isNamespaceImport, memberName} from '#rules/shared.ts'

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

function nullableType(input: {context: Context; node: ESTree.CallExpression}) {
	const type = input.node.typeArguments?.params[0]
	if (
		!isReactUseRef(input) ||
		input.node.arguments[0]?.type !== 'Literal' ||
		input.node.arguments[0].value !== null ||
		type?.type !== 'TSUnionType' ||
		!Array.some(type.types, member => member.type === 'TSNullKeyword')
	) {
		return Option.none()
	}
	return Option.some(type)
}

// The `|` next to the null member goes with it, so parentheses around the other members stay intact.
function removeNull(input: {context: Context; fixer: Fixer; member: ESTree.TSType; type: ESTree.TSUnionType}) {
	const before = input.context.sourceCode.getTokenBefore(input.member)
	if (before?.value === '|' && before.range[0] >= input.type.range[0]) {
		return Option.some(input.fixer.removeRange([before.range[0], input.member.range[1]]))
	}
	return pipe(
		Option.fromNullishOr(input.context.sourceCode.getTokenAfter(input.member)),
		Option.filter(token => token.value === '|'),
		Option.map(token => input.fixer.removeRange([input.member.range[0], token.range[1]]))
	)
}

export const noRedundantUseRefNullType = defineRule({
	create: context => ({
		CallExpression: node => {
			Option.match(nullableType({context, node}), {
				onNone: Function.constVoid,
				onSome: type =>
					context.report({
						fix: fixer =>
							pipe(
								Array.findFirst(type.types, member => member.type === 'TSNullKeyword'),
								Option.flatMap(member => removeNull({context, fixer, member, type})),
								Option.toArray
							),
						message: 'Remove null from the explicit useRef type; the null initializer already owns it.',
						node
					})
			})
		}
	}),
	meta: {fixable: 'code', type: 'problem'}
})
