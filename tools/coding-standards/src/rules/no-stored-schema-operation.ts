import {defineRule} from '@oxlint/plugins'
import type {ESTree} from '@oxlint/plugins'

import {isSchemaOperationCall} from '#rules/shared.ts'

// An options object passed straight to a call, such as a router's `{validateSearch: Schema.decodeUnknownSync(Search)}`, hands the operation to its consumer.
function passedToCall(node: ESTree.ObjectProperty) {
	return (
		node.parent.type === 'ObjectExpression' &&
		(node.parent.parent.type === 'CallExpression' || node.parent.parent.type === 'NewExpression') &&
		node.parent.parent.callee !== node.parent
	)
}

function storedSchemaOperation(node: ESTree.CallExpression) {
	return (
		(node.parent.type === 'VariableDeclarator' && node.parent.init === node) ||
		(node.parent.type === 'Property' && node.parent.value === node && !passedToCall(node.parent)) ||
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
