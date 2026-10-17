import {Array} from 'effect'

import {defineRule} from '@oxlint/plugins'

export const noBarrelModule = defineRule({
	create: context => ({
		ExportAllDeclaration: node => {
			context.report({message: 'Import from the module that defines each name; never re-export a whole module.', node})
		},
		Program: node => {
			const statements = Array.filter(node.body, statement => statement.type !== 'ImportDeclaration')
			if (
				Array.isArrayEmpty(statements) ||
				!Array.every(statements, statement => statement.type === 'ExportNamedDeclaration' && statement.source !== null)
			) {
				return
			}
			context.report({message: 'Import from the defining modules instead of a file that only re-exports them.', node})
		}
	}),
	meta: {type: 'problem'}
})
