import {Array, Number, Option, Predicate, String, pipe} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {ESTree} from 'vite-plus/lint/plugins'

const MESSAGE =
	'Draw a Phosphor icon regular at 16px and below and light at 20px and above, so strokes keep one weight on screen.'

function attribute(node: ESTree.JSXOpeningElement, name: string) {
	return Array.findFirst(
		node.attributes,
		(found): found is ESTree.JSXAttribute =>
			found.type === 'JSXAttribute' && found.name.type === 'JSXIdentifier' && found.name.name === name
	)
}

function literal(found: ESTree.JSXAttribute) {
	return pipe(
		Option.fromNullishOr(found.value),
		Option.filter(value => value.type === 'Literal'),
		Option.flatMap(value => Option.liftPredicate(value.value, Predicate.isString))
	)
}

export const iconWeight = defineRule({
	create: context => {
		const file = {icons: Array.empty<string>()}
		return {
			JSXOpeningElement: node => {
				if (node.name.type !== 'JSXIdentifier' || !Array.contains(file.icons, node.name.name)) return
				const weight = Option.flatMap(attribute(node, 'weight'), literal)
				// Pixels from the `size-N` class, four a step.
				const size = Option.getOrUndefined(
					pipe(
						attribute(node, 'className'),
						Option.flatMap(literal),
						Option.flatMap(String.match(/(?:^|\s)size-(\d+)(?:\s|$)/u)),
						Option.flatMap(match => Option.fromUndefinedOr(match[1])),
						Option.flatMap(Number.parse),
						Option.map(steps => steps * 4)
					)
				)
				if (size === undefined) return
				if (size >= 20 && !Option.contains(weight, 'light')) {
					context.report({
						fix: fixer =>
							Option.match(attribute(node, 'weight'), {
								onNone: () =>
									fixer.insertTextAfter(
										Option.getOrElse(Array.last(node.attributes), () => node.name),
										' weight="light"'
									),
								onSome: found => fixer.replaceText(found, 'weight="light"')
							}),
						message: MESSAGE,
						node
					})
				}
				if (size <= 16 && Option.contains(weight, 'light')) {
					context.report({
						fix: fixer =>
							Option.match(attribute(node, 'weight'), {onNone: () => [], onSome: found => fixer.remove(found)}),
						message: MESSAGE,
						node
					})
				}
			},
			Program: program => {
				file.icons = Array.flatMap(program.body, statement => {
					if (statement.type !== 'ImportDeclaration' || statement.source.value !== '@phosphor-icons/react') return []
					return Array.map(statement.specifiers, specifier => specifier.local.name)
				})
			}
		}
	},
	meta: {fixable: 'code', type: 'suggestion'}
})
