import {defineRule} from 'vite-plus/lint/plugins'

export const noBarrelModule = defineRule({
	create: context => ({
		ExportAllDeclaration: node => {
			context.report({message: 'Import from the module that defines each name; never re-export a whole module.', node})
		},
		ExportNamedDeclaration: node => {
			if (node.source === null) return
			context.report({message: 'Import from the module that defines this name; never re-export it.', node})
		}
	}),
	meta: {type: 'problem'}
})
