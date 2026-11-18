import {Array, Option, Predicate, String, pipe} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {Context, ESTree} from 'vite-plus/lint/plugins'

import {isImportBinding, matches, resolveBinding} from '#lib/ast.ts'

const SWIFT_UI = /^@expo\/ui\/swift-ui(?:\/|$)/u

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

// A widget's serialized body cannot import the app theme, including inside its nested helpers.
function insideWidget(node: ESTree.Node): boolean {
	if (
		node.type === 'BlockStatement' &&
		Array.some(node.body, statement => statement.type === 'ExpressionStatement' && statement.directive === 'widget')
	) {
		return true
	}
	if (node.parent === null) return false
	return insideWidget(node.parent)
}

// A literal, or a constant naming one, so a size moved into a local name is still a size.
function isNumber(context: Context, node?: ESTree.Node) {
	if (node === undefined) return false
	const value = resolveBinding(context, node)
	return value.type === 'Literal' && Predicate.isNumber(value.value) && value.value !== 0
}

// Only a modifier imported from Expo UI's SwiftUI is one; a local function may share its name.
function modifierName(context: Context, node: ESTree.CallExpression) {
	if (node.callee.type !== 'Identifier' || !isImportBinding({context, node: node.callee, source: SWIFT_UI})) return ''
	return node.callee.name
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

export const swiftuiThemeValues = defineRule({
	create: context => {
		const file = {elements: Array.empty<string>()}
		return {
			CallExpression: node => {
				if (insideWidget(node)) return
				const name = modifierName(context, node)
				if (
					(Array.contains(['listRowInsets', 'padding'], name) &&
						Array.some(properties(node.arguments[0]), property => isNumber(context, property.value))) ||
					(name === 'lineSpacing' && isNumber(context, node.arguments[0]))
				) {
					report(context, node, 'Space with the theme’s spacing steps, such as padding({all: space[4]}).')
				}
				if (name === 'font' && Array.some(properties(node.arguments[0]), property => keyOf(property) === 'size')) {
					report(context, node, 'Set type with a text token or a Dynamic Type textStyle, not a point size.')
				}
				// A colour comes as the argument itself or as an option such as strokeBorder({content}).
				if (
					Array.contains(PAINTS, name) &&
					pipe(
						node.arguments,
						Array.flatMap(argument => [argument, ...Array.map(properties(argument), property => property.value)]),
						Array.some(
							value =>
								value.type === 'Literal' &&
								Predicate.isString(value.value) &&
								Option.isSome(String.match(/^#[\da-f]{3,8}$/iu)(value.value))
						)
					)
				) {
					report(context, node, 'Paint with the theme’s colors, which follow light and dark, not a hex string.')
				}
			},
			ImportDeclaration: node => {
				if (matches(SWIFT_UI)(node.source.value)) {
					file.elements = [...file.elements, ...Array.map(node.specifiers, specifier => specifier.local.name)]
				}
			},
			JSXOpeningElement: node => {
				if (
					node.name.type !== 'JSXIdentifier' ||
					!Array.contains(file.elements, node.name.name) ||
					insideWidget(node)
				) {
					return
				}
				for (const attribute of node.attributes) {
					if (
						attribute.type === 'JSXAttribute' &&
						attribute.name.type === 'JSXIdentifier' &&
						attribute.name.name === 'spacing' &&
						attribute.value?.type === 'JSXExpressionContainer' &&
						isNumber(context, attribute.value.expression)
					) {
						report(context, attribute, 'Space a stack with the theme’s spacing steps, such as spacing={space[3]}.')
					}
				}
			}
		}
	},
	meta: {
		docs: {
			examples: {
				accepted: [
					{
						'sample.tsx': `import {Text} from '@expo/ui/swift-ui'
import {font, padding} from '@expo/ui/swift-ui/modifiers'
export function Title() { 'widget'; return <Text modifiers={[font({size: 15}), padding({all: 16})]}>Hello</Text> }`
					},
					{
						'sample.tsx': `import {Text} from '@expo/ui/swift-ui'
import {padding} from '@expo/ui/swift-ui/modifiers'
import {space} from './theme.ts'
export function Title(props: {title: string}) { return <Text modifiers={[padding({horizontal: space[4]})]}>{props.title}</Text> }`,
						'theme.ts': 'export const space = {4: 16}'
					}
				]
			}
		},
		type: 'problem'
	}
})
