import {Array, Option, Predicate, pipe} from 'effect'

import type {Context, ESTree, Scope, Variable} from '@oxlint/plugins'

export function variableFromScope(input: {name: string; scope: Scope | null}): Option.Option<Variable> {
	if (input.scope === null) return Option.none()
	const scope = input.scope
	return pipe(
		Option.fromNullishOr(scope.set.get(input.name)),
		Option.orElse(() => variableFromScope({name: input.name, scope: scope.upper}))
	)
}

export function variableFor(context: Context, node: ESTree.IdentifierReference) {
	return variableFromScope({name: node.name, scope: context.sourceCode.getScope(node)})
}

export function isImportBinding(input: {
	context: Context
	importedName: string
	node: ESTree.IdentifierReference
	source: string | RegExp
}) {
	return pipe(
		variableFor(input.context, input.node),
		Option.exists(variable =>
			Array.some(variable.defs, definition => {
				if (definition.type !== 'ImportBinding' || definition.parent?.type !== 'ImportDeclaration') return false
				const source = definition.parent.source.value
				if (Predicate.isString(input.source) ? source !== input.source : !input.source.test(source)) return false
				return (
					definition.node.type === 'ImportSpecifier' &&
					definition.node.imported.type === 'Identifier' &&
					definition.node.imported.name === input.importedName
				)
			})
		)
	)
}

export function isNamespaceImport(input: {context: Context; node: ESTree.IdentifierReference; source: string}) {
	return pipe(
		variableFor(input.context, input.node),
		Option.exists(variable =>
			Array.some(
				variable.defs,
				definition =>
					definition.type === 'ImportBinding' &&
					definition.node.type === 'ImportNamespaceSpecifier' &&
					definition.parent?.type === 'ImportDeclaration' &&
					definition.parent.source.value === input.source
			)
		)
	)
}

export function memberName(node: ESTree.MemberExpression) {
	if (!node.computed && node.property.type === 'Identifier') return Option.some(node.property.name)
	if (node.computed && node.property.type === 'Literal' && Predicate.isString(node.property.value)) {
		return Option.some(node.property.value)
	}
	return Option.none()
}

export function importedMember(input: {
	context: Context
	importedName: string
	node: ESTree.Expression
	propertyName?: string
}): input is {context: Context; importedName: string; node: ESTree.MemberExpression; propertyName?: string} {
	return (
		input.node.type === 'MemberExpression' &&
		input.node.object.type === 'Identifier' &&
		isImportBinding({
			context: input.context,
			importedName: input.importedName,
			node: input.node.object,
			source: 'effect'
		}) &&
		(input.propertyName === undefined || Option.contains(memberName(input.node), input.propertyName))
	)
}

export function isSchemaOperationName(name: string) {
	return /^(?:(?:decode|encode)(?:Unknown)?(?:Effect|Exit|Option|Promise|Result|Sync)|asserts|is)$/u.test(name)
}

export function isSchemaOperationCall(input: {context: Context; node: ESTree.CallExpression}) {
	if (
		input.node.callee.type !== 'MemberExpression' ||
		!importedMember({context: input.context, importedName: 'Schema', node: input.node.callee})
	) {
		return false
	}
	return pipe(memberName(input.node.callee), Option.exists(isSchemaOperationName))
}

export function isReactUseState(input: {context: Context; node: ESTree.CallExpression}) {
	if (input.node.callee.type === 'Identifier') {
		return isImportBinding({context: input.context, importedName: 'useState', node: input.node.callee, source: 'react'})
	}
	return (
		input.node.callee.type === 'MemberExpression' &&
		Option.contains(memberName(input.node.callee), 'useState') &&
		input.node.callee.object.type === 'Identifier' &&
		isNamespaceImport({context: input.context, node: input.node.callee.object, source: 'react'})
	)
}
