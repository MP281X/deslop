import {Array, Option, Predicate, Record, pipe} from 'effect'

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

export function statementDeclaration(statement: ESTree.Statement | ESTree.ModuleDeclaration) {
	return statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement
}

export function typeAlias(statement: ESTree.Statement | ESTree.ModuleDeclaration) {
	const declaration = statementDeclaration(statement)
	return declaration?.type === 'TSTypeAliasDeclaration' ? Option.some(declaration) : Option.none()
}

export function isInferredType(input: {name: string; node: ESTree.TSType}) {
	return (
		input.node.type === 'TSTypeQuery' &&
		input.node.exprName.type === 'TSQualifiedName' &&
		input.node.exprName.left.type === 'Identifier' &&
		input.node.exprName.left.name === input.name &&
		input.node.exprName.right.name === 'Type'
	)
}

function schemaQualifiedType(input: {context: Context; node: ESTree.TSType; propertyName: string}) {
	return (
		input.node.type === 'TSTypeReference' &&
		input.node.typeName.type === 'TSQualifiedName' &&
		input.node.typeName.left.type === 'Identifier' &&
		input.node.typeName.left.name === 'Schema' &&
		input.node.typeName.right.name === input.propertyName &&
		isImportBinding({context: input.context, importedName: 'Schema', node: input.node.typeName.left, source: 'effect'})
	)
}

export function schemaSchemaType(input: {context: Context; node: ESTree.TSType}) {
	return schemaQualifiedType({context: input.context, node: input.node, propertyName: 'Schema'})
}

function typeArgumentName(node: ESTree.TSType) {
	if (node.type !== 'TSTypeReference' || node.typeArguments === null) return Option.none<string>()
	return pipe(
		Array.get(node.typeArguments.params, 0),
		Option.flatMap(parameter =>
			parameter.type === 'TSTypeReference' && parameter.typeName.type === 'Identifier'
				? Option.some(parameter.typeName.name)
				: Option.none<string>()
		)
	)
}

function suspendedTypeName(input: {context: Context; node: ESTree.CallExpression}) {
	if (
		input.node.callee.type === 'Super' ||
		!importedMember({context: input.context, importedName: 'Schema', node: input.node.callee, propertyName: 'suspend'})
	) {
		return Option.none()
	}
	return pipe(
		Array.get(input.node.arguments, 0),
		Option.flatMap(argument =>
			argument.type === 'ArrowFunctionExpression' || argument.type === 'FunctionExpression'
				? Option.fromNullishOr(argument.returnType)
				: Option.none()
		),
		Option.filter(
			returnType =>
				schemaQualifiedType({context: input.context, node: returnType.typeAnnotation, propertyName: 'Codec'}) ||
				schemaSchemaType({context: input.context, node: returnType.typeAnnotation})
		),
		Option.flatMap(returnType => typeArgumentName(returnType.typeAnnotation))
	)
}

function referencedTypeNames(node: ESTree.TSType | ESTree.TSTupleElement): string[] {
	if (node.type === 'TSTypeReference') {
		const argumentNames = pipe(
			Option.fromNullishOr(node.typeArguments),
			Option.map(typeArguments => pipe(typeArguments.params, Array.flatMap(referencedTypeNames))),
			Option.getOrElse(() => Array.empty<string>())
		)
		return node.typeName.type === 'Identifier' ? Array.prepend(argumentNames, node.typeName.name) : argumentNames
	}
	if (node.type === 'TSArrayType') return referencedTypeNames(node.elementType)
	if (node.type === 'TSUnionType' || node.type === 'TSIntersectionType') {
		return pipe(node.types, Array.flatMap(referencedTypeNames))
	}
	if (node.type === 'TSTemplateLiteralType') return pipe(node.types, Array.flatMap(referencedTypeNames))
	if (
		node.type === 'TSTypeOperator' ||
		node.type === 'TSParenthesizedType' ||
		node.type === 'TSOptionalType' ||
		node.type === 'TSRestType'
	) {
		return referencedTypeNames(node.typeAnnotation)
	}
	if (node.type === 'TSNamedTupleMember') return referencedTypeNames(node.elementType)
	if (node.type === 'TSTupleType') return pipe(node.elementTypes, Array.flatMap(referencedTypeNames))
	if (node.type === 'TSIndexedAccessType') {
		return Array.appendAll(referencedTypeNames(node.objectType), referencedTypeNames(node.indexType))
	}
	if (node.type === 'TSConditionalType') {
		return pipe([node.checkType, node.extendsType, node.trueType, node.falseType], Array.flatMap(referencedTypeNames))
	}
	if (node.type === 'TSFunctionType' || node.type === 'TSConstructorType') {
		return referencedTypeNames(node.returnType.typeAnnotation)
	}
	if (node.type === 'TSMappedType') {
		return pipe(
			[node.constraint, node.nameType, node.typeAnnotation],
			Array.map(child => Option.fromNullishOr(child)),
			Array.getSomes,
			Array.flatMap(referencedTypeNames)
		)
	}
	if (node.type === 'TSTypeLiteral') return pipe(node.members, Array.flatMap(memberTypeNames))
	return Array.empty<string>()
}

function memberTypeNames(member: ESTree.TSSignature): string[] {
	if (member.type === 'TSIndexSignature') return referencedTypeNames(member.typeAnnotation.typeAnnotation)
	return pipe(
		Option.fromNullishOr(member.type === 'TSPropertySignature' ? member.typeAnnotation : member.returnType),
		Option.map(annotation => referencedTypeNames(annotation.typeAnnotation)),
		Option.getOrElse(() => Array.empty<string>())
	)
}

function topLevelTypeAliases(program: ESTree.Program) {
	return pipe(
		program.body,
		Array.map(statement =>
			pipe(
				typeAlias(statement),
				Option.filter(declaration => !isInferredType({name: declaration.id.name, node: declaration.typeAnnotation}))
			)
		),
		Array.getSomes
	)
}

function closedCycleNames(input: {aliases: ESTree.TSTypeAliasDeclaration[]; names: string[]}): string[] {
	const added = pipe(
		input.aliases,
		Array.filter(
			alias =>
				!Array.contains(input.names, alias.id.name) &&
				Array.some(referencedTypeNames(alias.typeAnnotation), name => Array.contains(input.names, name))
		),
		Array.map(alias => alias.id.name)
	)
	if (Array.isArrayEmpty(added)) return input.names
	return closedCycleNames({aliases: input.aliases, names: Array.appendAll(input.names, added)})
}

function isNode(value: unknown): value is ESTree.Node {
	return Predicate.hasProperty(value, 'type') && Predicate.isString(value.type)
}

function childNodes(node: unknown): ESTree.Node[] {
	if (!Predicate.isReadonlyObject(node)) return Array.empty<ESTree.Node>()
	return pipe(
		Record.toEntries(node),
		Array.filter(([key]) => key !== 'parent'),
		Array.flatMap(([, value]) => Array.ensure(value)),
		Array.filter(isNode)
	)
}

function suspendSeeds(input: {context: Context; node: ESTree.Node}): string[] {
	const seeds = pipe(
		childNodes(input.node),
		Array.flatMap(child => suspendSeeds({context: input.context, node: child}))
	)
	if (input.node.type !== 'CallExpression') return seeds
	return pipe(
		suspendedTypeName({context: input.context, node: input.node}),
		Option.match({onNone: () => seeds, onSome: name => Array.prepend(seeds, name)})
	)
}

export function schemaCycleNames(input: {context: Context; program: ESTree.Program}): string[] {
	return closedCycleNames({
		aliases: topLevelTypeAliases(input.program),
		names: suspendSeeds({context: input.context, node: input.program})
	})
}
