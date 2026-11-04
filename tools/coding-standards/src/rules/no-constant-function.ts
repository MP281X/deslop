import {Array, Option, Predicate} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {Context, ESTree} from 'vite-plus/lint/plugins'

import {boundReads, returnedExpression, singleUseThunk} from '#rules/shared.ts'

function isConstantFunction(input: {context: Context; node: ESTree.Function | ESTree.ArrowFunctionExpression}) {
	if (
		input.node.async ||
		input.node.generator ||
		Array.isArrayNonEmpty(input.node.params) ||
		Predicate.isNotNullish(input.node.typeParameters)
	) {
		return false
	}
	const returned = returnedExpression(input.node)

	return (
		Predicate.isNotNullish(returned) &&
		((returned.type === 'Literal' && !Predicate.hasProperty(returned, 'regex')) ||
			(returned.type === 'TemplateLiteral' && Array.isArrayEmpty(returned.expressions))) &&
		Option.exists(boundReads(input), reads =>
			Array.every(
				reads,
				reference =>
					reference.identifier.parent.type === 'CallExpression' &&
					reference.identifier.parent.callee === reference.identifier
			)
		)
	)
}

function isConstBound(node: ESTree.ArrowFunctionExpression | ESTree.Function) {
	return (
		node.parent.type === 'VariableDeclarator' &&
		node.parent.parent.type === 'VariableDeclaration' &&
		node.parent.parent.kind === 'const'
	)
}

export const noConstantFunction = defineRule({
	create: context => {
		function report(node: ESTree.Function | ESTree.ArrowFunctionExpression) {
			if (isConstantFunction({context, node}) && !singleUseThunk({context, node})) {
				context.report({message: 'Inline this argument-free literal return at its call sites.', node})
			}
		}
		return {
			'ArrowFunctionExpression:exit': node => {
				if (isConstBound(node)) report(node)
			},
			'FunctionDeclaration:exit': report,
			'FunctionExpression:exit': node => {
				if (isConstBound(node)) report(node)
			}
		}
	},
	meta: {type: 'problem'}
})
