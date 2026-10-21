import {Option, String, pipe} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {Context, ESTree} from 'vite-plus/lint/plugins'

import {importedMember, isSchemaOperationCall, memberName} from '#rules/shared.ts'

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

	if (
		input.node.parent.type !== 'CallExpression' ||
		input.node.parent.arguments[0] !== input.node ||
		input.node.parent.callee.type !== 'MemberExpression'
	) {
		return false
	}
	return (
		importedMember({context: input.context, importedName: 'Schema', node: input.node.parent.callee}) &&
		pipe(memberName(input.node.parent.callee), Option.exists(String.startsWith('decode')))
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
