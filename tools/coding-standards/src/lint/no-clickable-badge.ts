import {Array, Option, pipe} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'

// A shadcn badge only labels: one that runs an action looks like a label and hides it from keyboards and readers.
export const noClickableBadge = defineRule({
	create: context => {
		const file = {badges: Array.empty<string>()}
		return {
			JSXOpeningElement: node => {
				if (node.name.type !== 'JSXIdentifier' || !Array.contains(file.badges, node.name.name)) return
				pipe(
					node.attributes,
					Array.findFirst(
						attribute =>
							attribute.type === 'JSXAttribute' &&
							attribute.name.type === 'JSXIdentifier' &&
							attribute.name.name === 'onClick'
					),
					Option.map(handler =>
						context.report({message: 'A badge only labels; run the action from a Button.', node: handler})
					)
				)
			},
			Program: program => {
				file.badges = Array.flatMap(program.body, statement => {
					if (statement.type !== 'ImportDeclaration') return []
					return Array.flatMap(statement.specifiers, specifier => {
						if (
							specifier.type === 'ImportSpecifier' &&
							specifier.imported.type === 'Identifier' &&
							specifier.imported.name === 'Badge'
						) {
							return [specifier.local.name]
						}
						return []
					})
				})
			}
		}
	},
	meta: {type: 'problem'}
})
