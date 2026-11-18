import {Array, Option, Record, pipe} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {Context, ESTree} from 'vite-plus/lint/plugins'

import {matches, variableOf} from '#lib/ast.ts'
import {primitiveClasses} from '#lint/primitive-classes.ts'

const MESSAGES: Record<string, string> = {
	Badge: 'A badge only labels; run the action from a <Button onClick={…}>.',
	TabsTrigger: 'A tab only picks a view; change it in the <Tabs onValueChange={…}>, or run an action from a <Button>.'
}

const HANDLER = /^on(?:Click|DoubleClick|KeyDown|KeyUp|MouseDown|MouseUp|PointerDown|PointerUp|TouchEnd|TouchStart)$/u

// Spread props carry a handler when their declared object type names one.
function spreadsHandler(context: Context, attribute: ESTree.JSXSpreadAttribute) {
	if (attribute.argument.type !== 'Identifier') return false
	return pipe(
		variableOf(context, attribute.argument),
		Option.flatMap(variable => Array.head(variable.defs)),
		Option.flatMap(definition => Option.fromNullishOr(definition.name.typeAnnotation)),
		Option.exists(
			annotation =>
				annotation.typeAnnotation.type === 'TSTypeLiteral' &&
				Array.some(
					annotation.typeAnnotation.members,
					member =>
						(member.type === 'TSPropertySignature' || member.type === 'TSMethodSignature') &&
						member.key.type === 'Identifier' &&
						HANDLER.test(member.key.name)
				)
		)
	)
}

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
								(attribute.type === 'JSXAttribute' &&
									attribute.name.type === 'JSXIdentifier' &&
									HANDLER.test(attribute.name.name)) ||
								(attribute.type === 'JSXSpreadAttribute' && spreadsHandler(context, attribute))
							) {
								context.report({message: label.message, node: attribute})
							}
						})
					)
				)
			},
			Program: program => {
				file.labels = Array.flatMap(program.body, statement => {
					// Only the registry's Badge and TabsTrigger are labels; a local component may share the name.
					if (
						statement.type !== 'ImportDeclaration' ||
						!Array.some(primitiveClasses.componentImports, pattern =>
							matches(new RegExp(pattern, 'u'))(statement.source.value)
						)
					) {
						return []
					}
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
	meta: {
		docs: {
			examples: {
				accepted: [
					{
						'sample.tsx': `import {Badge} from '@deslop/components-web/ui/badge'
import {Tabs, TabsContent, TabsList, TabsTrigger} from '@deslop/components-web/ui/tabs'
export function Views() { return <Tabs defaultValue="notes"><TabsList><TabsTrigger value="notes">Notes</TabsTrigger></TabsList><TabsContent value="notes"><Badge className="mt-2">Saved</Badge></TabsContent></Tabs> }`
					}
				]
			}
		},
		type: 'problem'
	}
})
