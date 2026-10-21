import {Array, Option, Predicate, Record, String, pipe} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {ESTree} from 'vite-plus/lint/plugins'

import {matches} from '#rules/shared.ts'

const PRIMITIVES: Record<string, string> = {button: 'Button', input: 'Input', select: 'Select', textarea: 'Textarea'}

const CONTROL_STYLE =
	/(?:^|:)(?:hover|focus|focus-visible|active):|(?:^|:)(?:rounded|shadow|ring)(?:-|$)|(?:^|:)p[blrtxy]?-(?!0$)|(?:^|:)bg-(?!transparent$)|(?:^|:)border(?:-[blrtxy])?$|(?:^|:)border-(?!0$|[blrtxy]-0$)/u

// Every string a className expression can produce: literals, template parts, and `cn(...)` or conditional arguments.
function classStrings(node: ESTree.Node): string[] {
	if (node.type === 'Literal') return Array.filter([node.value], Predicate.isString)
	if (node.type === 'TemplateLiteral') return Array.map(node.quasis, quasi => quasi.value.raw)
	if (node.type === 'JSXExpressionContainer') return classStrings(node.expression)
	if (node.type === 'CallExpression') return Array.flatMap(node.arguments, classStrings)
	if (node.type === 'ConditionalExpression') return Array.flatMap([node.consequent, node.alternate], classStrings)
	if (node.type === 'LogicalExpression') return classStrings(node.right)
	if (node.type === 'ArrayExpression') {
		return Array.flatMap(Array.filter(node.elements, Predicate.isNotNull), classStrings)
	}
	return Array.empty<string>()
}

export const noNativeControl = defineRule({
	create: context => ({
		JSXOpeningElement: node => {
			if (node.name.type !== 'JSXIdentifier') return
			const name = node.name.name
			Option.map(Record.get(PRIMITIVES, name), primitive => {
				const styled = pipe(
					node.attributes,
					Array.findFirst(
						attribute =>
							attribute.type === 'JSXAttribute' &&
							attribute.name.type === 'JSXIdentifier' &&
							attribute.name.name === 'className'
					),
					Option.map(attribute => {
						if (attribute.type !== 'JSXAttribute' || attribute.value === null) return Array.empty<string>()
						return classStrings(attribute.value)
					}),
					Option.exists(values =>
						Array.some(values, value => Array.some(String.split(value, /\s+/u), matches(CONTROL_STYLE)))
					)
				)
				if (name !== 'select' && !styled) return
				context.report({message: `Use the ${primitive} UI primitive instead of a styled native control.`, node})
			})
		}
	}),
	meta: {type: 'problem'}
})
