import {Array, Option, Predicate, pipe} from 'effect'

import {defineRule} from '@oxlint/plugins'
import type {Context, ESTree} from '@oxlint/plugins'

import {bindingName, returnedExpression, singleUseThunk, variableFromScope} from '#rules/shared.ts'

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
		pipe(
			bindingName(input.node),
			Option.flatMap(name => variableFromScope({name, scope: input.context.sourceCode.getScope(input.node)})),
			Option.exists(variable =>
				Array.every(
					Array.filter(variable.references, reference => reference.isRead()),
					reference =>
						reference.identifier.parent.type === 'CallExpression' &&
						reference.identifier.parent.callee === reference.identifier
				)
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
				context.report({
					message: 'This argument-free function returns a literal constant; hold its result in a const.',
					node
				})
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
