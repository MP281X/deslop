import {Array} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {ESTree} from 'vite-plus/lint/plugins'

function derived(node: ESTree.TSType): boolean {
	if (node.type === 'TSIndexedAccessType') return derived(node.objectType)
	if (node.type !== 'TSTypeReference') return false
	return (
		(node.typeName.type === 'Identifier' &&
			Array.contains(
				['Awaited', 'ConstructorParameters', 'InstanceType', 'Parameters', 'ReturnType'],
				node.typeName.name
			)) ||
		Array.some(node.typeArguments?.params ?? [], derived)
	)
}

export const noFloatingDerivedType = defineRule({
	create: context => ({
		TSTypeAliasDeclaration: node => {
			if (node.parent.type === 'ExportNamedDeclaration' || !derived(node.typeAnnotation)) return
			const listed = Array.some(
				context.sourceCode.ast.body,
				statement =>
					statement.type === 'ExportNamedDeclaration' &&
					Array.some(
						statement.specifiers,
						specifier => specifier.local.type === 'Identifier' && specifier.local.name === node.id.name
					)
			)
			if (listed) return
			context.report({
				message:
					"Import the library's exported type, else write ReturnType<typeof f> in the signature that needs it, or pass the value straight to the call that types it.",
				node
			})
		}
	}),
	meta: {
		docs: {
			examples: {
				accepted: [
					{
						'sample.ts': `export type Budget = ReturnType<typeof remaining>
export function remaining(limit: number, used: number) { return limit - used }`
					}
				]
			}
		},
		type: 'problem'
	}
})
