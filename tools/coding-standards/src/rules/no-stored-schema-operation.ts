import {Predicate} from 'effect'

import {defineRule} from '@oxlint/plugins'
import type {ESTree} from '@oxlint/plugins'

import {isSchemaOperationCall} from '#rules/shared.ts'

// An options object passed straight to a call, such as a router's `{validateSearch: Schema.decodeUnknownSync(Search)}`, hands the operation to its consumer; `Object.freeze` and `Object.assign` only keep it.
function passedToCall(input: {call: ESTree.Node | null; options: ESTree.Node}) {
	return (
		Predicate.isNotNull(input.call) &&
		(input.call.type === 'CallExpression' || input.call.type === 'NewExpression') &&
		input.call.callee !== input.options &&
		!(
			input.call.callee.type === 'MemberExpression' &&
			input.call.callee.object.type === 'Identifier' &&
			input.call.callee.object.name === 'Object'
		)
	)
}

function storedSchemaOperation(node: ESTree.CallExpression) {
	return (
		(node.parent.type === 'VariableDeclarator' && node.parent.init === node) ||
		(node.parent.type === 'Property' &&
			node.parent.value === node &&
			!passedToCall({call: node.parent.parent.parent, options: node.parent.parent})) ||
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
