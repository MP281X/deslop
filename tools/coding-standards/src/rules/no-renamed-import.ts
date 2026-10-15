import {defineRule} from '@oxlint/plugins'
import type {ESTree} from '@oxlint/plugins'

function exportedName(node: ESTree.ModuleExportName) {
	if (node.type === 'Literal') return node.value
	return node.name
}

export const noRenamedImport = defineRule({
	create: context => ({
		ImportSpecifier: node => {
			const imported = exportedName(node.imported)
			if (imported === node.local.name || (imported === 'it' && node.local.name === 'test')) return
			context.report({message: `Import ${imported} under its own name.`, node})
		}
	}),
	meta: {type: 'problem'}
})
