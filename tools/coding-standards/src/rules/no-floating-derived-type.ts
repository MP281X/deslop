import {Array} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {ESTree} from 'vite-plus/lint/plugins'

function derived(node: ESTree.TSType): boolean {
	if (node.type === 'TSIndexedAccessType') return derived(node.objectType)
	return (
		node.type === 'TSTypeReference' &&
		node.typeName.type === 'Identifier' &&
		Array.contains(['Awaited', 'ConstructorParameters', 'InstanceType', 'Parameters', 'ReturnType'], node.typeName.name)
	)
}

export const noFloatingDerivedType = defineRule({
	create: context => ({
		TSTypeAliasDeclaration: node => {
			const listed = Array.some(
				context.sourceCode.ast.body,
				statement =>
					statement.type === 'ExportNamedDeclaration' &&
					Array.some(
						statement.specifiers,
						specifier => specifier.local.type === 'Identifier' && specifier.local.name === node.id.name
					)
			)
			if (node.parent.type === 'ExportNamedDeclaration' || listed || !derived(node.typeAnnotation)) return
			context.report({
				message:
					"Import the library's exported type, else write ReturnType<typeof f> in the signature that needs it, or pass the value straight to the call that types it.",
				node
			})
		}
	}),
	meta: {type: 'problem'}
})
