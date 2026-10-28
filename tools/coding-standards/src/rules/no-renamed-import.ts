import {Array} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {ESTree} from 'vite-plus/lint/plugins'

function exportedName(node: ESTree.ModuleExportName) {
	if (node.type === 'Literal') return node.value
	return node.name
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
			context.report({message: `Import ${imported} under its own name.`, node})
		}
	}),
	meta: {type: 'problem'}
})
