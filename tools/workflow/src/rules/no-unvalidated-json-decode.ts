import {Option, String, pipe} from 'effect'

import {defineRule} from '@oxlint/plugins'
import type {Context, ESTree} from '@oxlint/plugins'

import {importedMember, isSchemaOperationCall, memberName} from './shared.ts'

function unknownJsonSchema(input: {context: Context; node: ESTree.CallExpression}) {
	if (
		isSchemaOperationCall(input) &&
		input.node.callee.type === 'MemberExpression' &&
		pipe(memberName(input.node.callee), Option.exists(String.startsWith('decode'))) &&
		input.node.arguments[0]?.type === 'MemberExpression' &&
		importedMember({
			context: input.context,
			importedName: 'Schema',
			node: input.node.arguments[0],
			propertyName: 'UnknownFromJsonString'
		})
	) {
		return true
	}
	if (
		input.node.callee.type !== 'MemberExpression' ||
		!importedMember({
			context: input.context,
			importedName: 'Schema',
			node: input.node.callee,
			propertyName: 'fromJsonString'
		}) ||
		input.node.arguments[0]?.type !== 'MemberExpression' ||
		!importedMember({
			context: input.context,
			importedName: 'Schema',
			node: input.node.arguments[0],
			propertyName: 'Unknown'
		})
	) {
		return false
	}
	const parent = input.node.parent
	if (
		parent.type !== 'CallExpression' ||
		parent.arguments[0] !== input.node ||
		parent.callee.type !== 'MemberExpression'
	) {
		return false
	}
	return (
		importedMember({context: input.context, importedName: 'Schema', node: parent.callee}) &&
		pipe(memberName(parent.callee), Option.exists(String.startsWith('decode')))
	)
}

export const noUnvalidatedJsonDecode = defineRule({
	create: context => ({
		CallExpression: node => {
			if (unknownJsonSchema({context, node})) {
				context.report({message: 'Replace Schema.Unknown with the protocol Schema at this JSON boundary.', node})
			}
		}
	}),
	meta: {type: 'problem'}
})
