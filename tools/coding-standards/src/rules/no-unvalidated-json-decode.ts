import {Array, Option, String, pipe} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {Context, ESTree} from 'vite-plus/lint/plugins'

import {importedMember, isImportBinding, memberName, resolveBinding} from '#rules/shared.ts'

function unknownSchema(context: Context, node: ESTree.Node) {
	const schema = resolveBinding(context, node)
	return (
		schema.type === 'MemberExpression' &&
		importedMember({context, importedName: 'Schema', node: schema, propertyName: 'Unknown'})
	)
}

function unknownJsonSchema(context: Context, node: ESTree.Node) {
	const schema = resolveBinding(context, node)
	if (schema.type === 'MemberExpression') {
		return importedMember({context, importedName: 'Schema', node: schema, propertyName: 'UnknownFromJsonString'})
	}
	return (
		schema.type === 'CallExpression' &&
		schema.callee.type !== 'Super' &&
		importedMember({context, importedName: 'Schema', node: schema.callee, propertyName: 'fromJsonString'}) &&
		schema.arguments[0] !== undefined &&
		unknownSchema(context, schema.arguments[0])
	)
}

function schemaDecoder(context: Context, callee: ESTree.Node) {
	return (
		callee.type === 'MemberExpression' &&
		importedMember({context, importedName: 'Schema', node: callee}) &&
		pipe(memberName(callee), Option.exists(String.startsWith('decode')))
	)
}

function protocolDecoder(context: Context, node: ESTree.Node) {
	const decoder = resolveBinding(context, node)
	return (
		decoder.type === 'CallExpression' &&
		schemaDecoder(context, resolveBinding(context, decoder.callee)) &&
		decoder.arguments[0] !== undefined &&
		!unknownSchema(context, decoder.arguments[0]) &&
		!unknownJsonSchema(context, decoder.arguments[0])
	)
}

// Preserve an immediately composed validation step, not arbitrary later uses of an unvalidated value.
function validatesResult(context: Context, node: ESTree.CallExpression) {
	const applied = pipe(
		Option.fromNullishOr(node.parent),
		Option.filter(parent => parent.type === 'CallExpression' && parent.callee === node),
		Option.getOrElse(() => node)
	)
	if (applied.parent?.type !== 'CallExpression') return false
	if (applied.parent.callee.type === 'CallExpression' && applied.parent.arguments[0] === applied) {
		return protocolDecoder(context, applied.parent.callee)
	}
	if (applied.parent.callee.type === 'Super' || applied.parent.arguments[0] !== applied) return false
	if (importedMember({context, importedName: 'Effect', node: applied.parent.callee, propertyName: 'flatMap'})) {
		return applied.parent.arguments[1] !== undefined && protocolDecoder(context, applied.parent.arguments[1])
	}
	if (
		applied.parent.callee.type !== 'Identifier' ||
		!isImportBinding({context, importedName: 'pipe', node: applied.parent.callee, source: 'effect'})
	) {
		return false
	}
	const next = applied.parent.arguments[1]
	if (next === undefined) return false
	if (protocolDecoder(context, next)) return true
	return (
		next.type === 'CallExpression' &&
		next.callee.type !== 'Super' &&
		importedMember({context, importedName: 'Effect', node: next.callee, propertyName: 'flatMap'}) &&
		next.arguments[0] !== undefined &&
		protocolDecoder(context, next.arguments[0])
	)
}

function httpDecoder(context: Context, callee: ESTree.Node) {
	if (
		callee.type !== 'MemberExpression' ||
		callee.object.type !== 'Identifier' ||
		!Option.contains(memberName(callee), 'schemaBodyJson')
	) {
		return false
	}
	return Array.some(
		['HttpClientResponse', 'HttpIncomingMessage', 'HttpServerRequest'],
		importedName =>
			callee.object.type === 'Identifier' &&
			isImportBinding({context, importedName, node: callee.object, source: 'effect/http'})
	)
}

export const noUnvalidatedJsonDecode = defineRule({
	create: context => ({
		CallExpression: node => {
			const schema = node.arguments[0]
			if (schema === undefined || node.callee.type === 'Super') return
			const callee = resolveBinding(context, node.callee)
			const unvalidated =
				(schemaDecoder(context, callee) && unknownJsonSchema(context, schema)) ||
				(httpDecoder(context, callee) && unknownSchema(context, schema))
			if (!unvalidated || validatesResult(context, node)) return
			context.report({message: 'Replace Schema.Unknown with the protocol Schema at this JSON boundary.', node})
		}
	}),
	meta: {type: 'problem'}
})
