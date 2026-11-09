import {Array, Option, Predicate, String} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {Context, ESTree} from 'vite-plus/lint/plugins'

// The modifiers that paint, whose colours come from the theme instead of a hex string.
const PAINTS = [
	'background',
	'border',
	'fill',
	'foregroundStyle',
	'listRowBackground',
	'listRowSeparatorTint',
	'strokeBorder',
	'tint'
]

function isNumber(node?: ESTree.Node) {
	return node?.type === 'Literal' && Predicate.isNumber(node.value) && node.value !== 0
}

function calleeName(node: ESTree.CallExpression) {
	if (node.callee.type === 'Identifier') return node.callee.name
	return ''
}

function properties(node?: ESTree.Node) {
	if (node?.type !== 'ObjectExpression') return []
	return Array.filter(node.properties, property => property.type === 'Property')
}

function keyOf(property: ESTree.ObjectProperty) {
	if (property.key.type === 'Identifier') return property.key.name
	return ''
}

function report(context: Context, node: ESTree.Node, message: string) {
	context.report({message, node})
}

// shadcn's token rules for @expo/ui: spacing, type and colours come from the theme, never literals.
export const swiftuiThemeValues = defineRule({
	create: context => {
		const file = {swiftui: false}
		return {
			CallExpression: node => {
				if (!file.swiftui) return
				const name = calleeName(node)
				if (
					(Array.contains(['listRowInsets', 'padding'], name) &&
						Array.some(properties(node.arguments[0]), property => isNumber(property.value))) ||
					(name === 'lineSpacing' && isNumber(node.arguments[0]))
				) {
					report(context, node, 'Space with the theme’s spacing steps, such as padding({all: space[4]}).')
				}
				if (name === 'font' && Array.some(properties(node.arguments[0]), property => keyOf(property) === 'size')) {
					report(context, node, 'Set type with a text token or a Dynamic Type textStyle, not a point size.')
				}
				// A colour comes as the argument itself or as an option such as strokeBorder({content}).
				if (
					Array.contains(PAINTS, name) &&
					Array.some(
						Array.flatMap(node.arguments, argument => [
							argument,
							...Array.map(properties(argument), property => property.value)
						]),
						value =>
							value.type === 'Literal' &&
							Predicate.isString(value.value) &&
							Option.isSome(String.match(/^#[\da-f]{3,8}$/iu)(value.value))
					)
				) {
					report(context, node, 'Paint with the theme’s colors, which follow light and dark, not a hex string.')
				}
			},
			ImportDeclaration: node => {
				if (String.startsWith('@expo/ui/swift-ui')(node.source.value)) file.swiftui = true
			},
			JSXAttribute: node => {
				if (
					file.swiftui &&
					node.name.type === 'JSXIdentifier' &&
					node.name.name === 'spacing' &&
					node.value?.type === 'JSXExpressionContainer' &&
					isNumber(node.value.expression)
				) {
					report(context, node, 'Space a stack with the theme’s spacing steps, such as spacing={space[3]}.')
				}
			}
		}
	},
	meta: {type: 'problem'}
})
