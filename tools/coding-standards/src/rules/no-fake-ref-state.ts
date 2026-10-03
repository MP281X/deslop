import {Array, Option, Predicate, pipe} from 'effect'

import {defineRule} from '@oxlint/plugins'
import type {Context, ESTree} from '@oxlint/plugins'

import {isReactUseState, variableFromScope} from '#rules/shared.ts'

function propertyName(node: ESTree.ObjectProperty) {
	if (!node.computed && node.key.type === 'Identifier') return Option.some(node.key.name)
	if (node.key.type === 'Literal' && Predicate.isString(node.key.value)) return Option.some(node.key.value)
	return Option.none()
}

function hasUnusedSetter(input: {context: Context; node: ESTree.CallExpression}) {
	const declaration = input.node.parent
	if (declaration.type !== 'VariableDeclarator' || declaration.id.type !== 'ArrayPattern') return false
	const setter = declaration.id.elements[1]
	if (Predicate.isNullish(setter)) return true
	if (setter.type !== 'Identifier') return false
	return pipe(
		variableFromScope({name: setter.name, scope: input.context.sourceCode.getScope(setter)}),
		Option.exists(variable => !Array.some(variable.references, reference => reference.isRead()))
	)
}

function isFakeRefState(input: {context: Context; node: ESTree.CallExpression}) {
	if (
		!isReactUseState(input) ||
		input.node.arguments[0]?.type !== 'ArrowFunctionExpression' ||
		input.node.arguments[0].body.type !== 'ObjectExpression' ||
		input.node.arguments[0].body.properties.length !== 1 ||
		!hasUnusedSetter(input)
	) {
		return false
	}
	return Array.some(
		input.node.arguments[0].body.properties,
		property =>
			property.type === 'Property' &&
			Option.contains(propertyName(property), 'current') &&
			property.value.type === 'Literal' &&
			property.value.value === null
	)
}

export const noFakeRefState = defineRule({
	create: context => ({
		CallExpression: node => {
			if (isFakeRefState({context, node})) {
				context.report({message: 'Use useRef for ref-shaped lifecycle state.', node})
			}
		}
	}),
	meta: {type: 'problem'}
})
