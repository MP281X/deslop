import {Array, Option} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {Context, ESTree, Fixer, Reference} from 'vite-plus/lint/plugins'

import {boundVariable, variableFromScope} from '#rules/shared.ts'

function exportedName(node: ESTree.ModuleExportName) {
	if (node.type === 'Literal') return node.value
	return node.name
}

// A reference that the import's own name would bind to something else: an inner variable, or a global the file also reads.
function captured(input: {context: Context; imported: string; reference: Reference}) {
	return (
		Option.isSome(
			boundVariable({name: input.imported, scope: input.context.sourceCode.getScope(input.reference.identifier)})
		) || input.reference.identifier.parent.type === 'ExportSpecifier'
	)
}

// `import {a as b}` becomes `import {a}`, and every read of `b` reads `a`; `{b}` keeps its key as `{b: a}`.
function fix(input: {context: Context; fixer: Fixer; imported: string; node: ESTree.ImportSpecifier}) {
	const scope = input.context.sourceCode.getScope(input.node)
	const unresolved = Array.some(
		input.context.sourceCode.scopeManager.globalScope?.through ?? [],
		reference => reference.identifier.name === input.imported
	)
	if (unresolved || Option.isSome(boundVariable({name: input.imported, scope}))) return []
	return Option.getOrElse(
		Option.flatMap(variableFromScope({name: input.node.local.name, scope}), variable => {
			if (Array.some(variable.references, reference => captured({...input, reference}))) return Option.none()
			return Option.some([
				input.fixer.removeRange([input.node.imported.range[1], input.node.local.range[1]]),
				...Array.map(variable.references, reference => {
					if (reference.identifier.parent.type === 'Property' && reference.identifier.parent.shorthand) {
						return input.fixer.replaceText(reference.identifier.parent, `${input.node.local.name}: ${input.imported}`)
					}
					return input.fixer.replaceText(reference.identifier, input.imported)
				})
			])
		}),
		() => []
	)
}

export const noRenamedImport = defineRule({
	create: context => ({
		// `default` and a string name such as 'module.exports' are the module system's names, not a second name.
		ExportSpecifier: node => {
			const local = exportedName(node.local)
			if (node.exported.type === 'Literal' || Array.contains([local, 'default'], exportedName(node.exported))) return
			context.report({message: `Export ${local} under its own name.`, node})
		},
		ImportSpecifier: node => {
			const imported = exportedName(node.imported)
			if (imported === node.local.name || (imported === 'it' && node.local.name === 'test')) return
			context.report({
				fix: fixer => {
					if (node.imported.type === 'Literal' || imported === 'default') return []
					return fix({context, fixer, imported, node})
				},
				message: `Import ${imported} under its own name.`,
				node
			})
		}
	}),
	meta: {fixable: 'code', type: 'problem'}
})
