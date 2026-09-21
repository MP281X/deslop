import {Array, Option, Predicate} from 'effect'

import {defineRule} from '@oxlint/plugins'
import type {Context, ESTree} from '@oxlint/plugins'

import {isReactUseState} from './shared.ts'

function propertyName(node: ESTree.ObjectProperty) {
	if (!node.computed && node.key.type === 'Identifier') return Option.some(node.key.name)
	if (node.key.type === 'Literal' && Predicate.isString(node.key.value)) return Option.some(node.key.value)
	return Option.none()
}

function isFakeRefState(input: {context: Context; node: ESTree.CallExpression}) {
	if (
		!isReactUseState(input) ||
		input.node.arguments[0]?.type !== 'ArrowFunctionExpression' ||
		input.node.arguments[0].body.type !== 'ObjectExpression'
	) {
		return false
	}
	return Array.some(
		input.node.arguments[0].body.properties,
		property => property.type === 'Property' && Option.contains(propertyName(property), 'current')
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
