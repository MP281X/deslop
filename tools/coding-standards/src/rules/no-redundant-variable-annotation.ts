import {Array, Option, Predicate} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {Context, ESTree, Fixer} from 'vite-plus/lint/plugins'

import {effectImport} from '#rules/shared.ts'

// The element type of `T[]`, `readonly T[]`, `Array<T>` or `ReadonlyArray<T>`.
function elementType(node: ESTree.TSType): Option.Option<ESTree.TSType> {
	if (node.type === 'TSArrayType') return Option.some(node.elementType)
	if (node.type === 'TSTypeOperator' && node.operator === 'readonly' && Predicate.isNotNullish(node.typeAnnotation)) {
		return elementType(node.typeAnnotation)
	}
	if (
		node.type === 'TSTypeReference' &&
		node.typeName.type === 'Identifier' &&
		Array.contains(['Array', 'ReadonlyArray'], node.typeName.name)
	) {
		return Option.fromNullishOr(node.typeArguments?.params[0])
	}
	return Option.none()
}

// `const items: T[] = []` becomes `const items = Array.empty<T>()`.
function fix(input: {
	annotation: ESTree.TSTypeAnnotation
	context: Context
	fixer: Fixer
	init: ESTree.ArrayExpression
}) {
	return Option.getOrElse(
		Option.flatMap(elementType(input.annotation.typeAnnotation), element =>
			Option.map(
				effectImport({context: input.context, fixer: input.fixer, name: 'Array', node: input.init}),
				imports => [
					...imports,
					input.fixer.remove(input.annotation),
					input.fixer.replaceText(input.init, `Array.empty<${input.context.sourceCode.getText(element)}>()`)
				]
			)
		),
		() => []
	)
}

export const noRedundantVariableAnnotation = defineRule({
	create: context => ({
		VariableDeclarator: node => {
			const init = node.init
			const annotation = node.id.typeAnnotation
			if (init?.type !== 'ArrayExpression' || Predicate.isNullish(annotation)) return
			if (!Array.isArrayEmpty(init.elements)) return
			context.report({
				fix: fixer => fix({annotation, context, fixer, init}),
				message: 'Write Array.empty<T>() instead of annotating an empty array.',
				node: annotation
			})
		}
	}),
	meta: {fixable: 'code', type: 'problem'}
})
