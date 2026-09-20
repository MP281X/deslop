import {defineRule} from '@oxlint/plugins'
import type {ESTree} from '@oxlint/plugins'

import {isSchemaOperationCall} from './shared.ts'

function storedSchemaOperation(node: ESTree.CallExpression) {
	return (
		(node.parent.type === 'VariableDeclarator' && node.parent.init === node) ||
		(node.parent.type === 'Property' && node.parent.value === node) ||
		(node.parent.type === 'PropertyDefinition' && node.parent.value === node) ||
		node.parent.type === 'ArrayExpression' ||
		(node.parent.type === 'AssignmentExpression' && node.parent.right === node)
	)
}

export const noStoredSchemaOperation = defineRule({
	create: context => ({
		CallExpression: node => {
			if (isSchemaOperationCall({context, node}) && storedSchemaOperation(node)) {
				context.report({
					message: 'Inline this Schema operation at its consumption site; never store compiled operations.',
					node
				})
			}
		}
	}),
	meta: {type: 'problem'}
})
