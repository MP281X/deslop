import {Array, Option, Predicate, pipe} from 'effect'

import {defineRule} from '@oxlint/plugins'
import type {ESTree} from '@oxlint/plugins'

import {isSchemaCodecType} from './shared.ts'

function isMapLikeType(node: ESTree.TSType): boolean {
	if (node.type === 'TSMappedType') return true
	if (node.type !== 'TSTypeReference' || node.typeName.type !== 'Identifier') return false
	if (node.typeName.name === 'Record') return true
	return (
		node.typeName.name === 'Partial' &&
		pipe(
			Option.fromNullishOr(node.typeArguments),
			Option.flatMap(typeArguments => Array.get(typeArguments.params, 0)),
			Option.exists(isMapLikeType)
		)
	)
}

export const noRedundantVariableAnnotation = defineRule({
	create: context => ({
		VariableDeclarator: node => {
			const annotation = node.id.typeAnnotation
			if (node.init === null || Predicate.isNullish(annotation)) return
			const type = annotation.typeAnnotation
			if (
				type.type === 'TSUnknownKeyword' ||
				isSchemaCodecType({context, node: type}) ||
				(node.init.type === 'Literal' && node.init.raw === 'null') ||
				(node.init.type === 'Identifier' && node.init.name === 'undefined') ||
				(node.init.type === 'ObjectExpression' && Array.isArrayEmpty(node.init.properties) && isMapLikeType(type))
			) {
				return
			}
			if (node.init.type === 'ArrayExpression' && Array.isArrayEmpty(node.init.elements)) {
				context.report({message: 'Write Array.empty<T>() instead of annotating an empty array.', node: annotation})
				return
			}
			context.report({message: 'Drop this annotation; the initializer already has its type.', node: annotation})
		}
	}),
	meta: {type: 'problem'}
})
