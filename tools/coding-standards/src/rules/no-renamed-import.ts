import {defineRule} from '@oxlint/plugins'

export const noRenamedImport = defineRule({
	create: context => ({
		ImportSpecifier: node => {
			const imported = node.imported.type === 'Literal' ? node.imported.value : node.imported.name
			if (imported === node.local.name || (imported === 'it' && node.local.name === 'test')) return
			context.report({message: `Import ${imported} under its own name.`, node})
		}
	}),
	meta: {type: 'problem'}
})
