import {Array, Option, Record, pipe} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'

const MESSAGES: Record<string, string> = {
	Badge: 'A badge only labels; run the action from a <Button onClick={…}>.',
	TabsTrigger: 'A tab only picks a view; change it in the <Tabs onValueChange={…}>, or run an action from a <Button>.'
}

const HANDLER = /^on(?:Click|DoubleClick|KeyDown|KeyUp|MouseDown|MouseUp|PointerDown|PointerUp|TouchEnd|TouchStart)$/u

// A badge or a tab looks like a label: one that runs an action hides it from whoever reads the page as labels.
export const noHandlerOnLabel = defineRule({
	create: context => {
		const file = {labels: Array.empty<{local: string; message: string}>()}
		return {
			JSXOpeningElement: node => {
				if (node.name.type !== 'JSXIdentifier') return
				const name = node.name.name
				pipe(
					file.labels,
					Array.findFirst(label => label.local === name),
					Option.map(label =>
						Array.forEach(node.attributes, attribute => {
							if (
								attribute.type === 'JSXAttribute' &&
								attribute.name.type === 'JSXIdentifier' &&
								HANDLER.test(attribute.name.name)
							) {
								context.report({message: label.message, node: attribute})
							}
						})
					)
				)
			},
			Program: program => {
				file.labels = Array.flatMap(program.body, statement => {
					if (statement.type !== 'ImportDeclaration') return []
					return Array.flatMap(statement.specifiers, specifier => {
						if (specifier.type !== 'ImportSpecifier' || specifier.imported.type !== 'Identifier') return []
						return pipe(
							MESSAGES,
							Record.get(specifier.imported.name),
							Option.match({onNone: () => [], onSome: message => [{local: specifier.local.name, message}]})
						)
					})
				})
			}
		}
	},
	meta: {type: 'problem'}
})
