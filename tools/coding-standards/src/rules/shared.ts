import {Array, Graph, Option, Predicate, Record, String, pipe} from 'effect'

import type {Context, ESTree, Fix, Fixer, Scope, Token, Variable} from '@oxlint/plugins'

// Names, literals and the openings of calls, arrays and objects run no code, so a getter cannot run before a moved read.
export function inert(token: Token) {
	if (Array.contains(['Boolean', 'Identifier', 'Null', 'Numeric', 'String'], token.type)) return true
	if (token.type === 'Keyword') return Array.contains(['const', 'new', 'return'], token.value)
	return token.type === 'Punctuator' && Array.contains(['(', ',', ':', '=', '[', '{'], token.value)
}

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
	importedName?: string
	node: ESTree.IdentifierReference
	source: string | RegExp
}) {
	return pipe(
		variableFor(input.context, input.node),
		Option.exists(variable =>
			Array.some(variable.defs, definition => {
				if (definition.type !== 'ImportBinding' || definition.parent?.type !== 'ImportDeclaration') return false
				if (Predicate.isString(input.source) && definition.parent.source.value !== input.source) return false
				if (Predicate.isRegExp(input.source) && !input.source.test(definition.parent.source.value)) return false
				return (
					input.importedName === undefined ||
					(definition.node.type === 'ImportSpecifier' &&
						definition.node.imported.type === 'Identifier' &&
						definition.node.imported.name === input.importedName)
				)
			})
		)
	)
}

function importedName(specifier: ESTree.ImportDeclarationSpecifier) {
	if (specifier.type !== 'ImportSpecifier' || specifier.imported.type !== 'Identifier') return ''
	return specifier.imported.name
}

// A fix that calls Predicate uses the file's Predicate import, or adds Predicate in its sorted place to the file's named import from 'effect', which makes the fix span from the import to the call, so the file's other Predicate fixes follow on the next fix run; with neither import, there is no fix.
export function predicateImport(input: {context: Context; fixer: Fixer; node: ESTree.Node}) {
	return pipe(
		variableFromScope({name: 'Predicate', scope: input.context.sourceCode.getScope(input.node)}),
		Option.match({
			onNone: () =>
				pipe(
					input.context.sourceCode.ast.body,
					Array.findFirst(
						statement =>
							statement.type === 'ImportDeclaration' &&
							statement.source.value === 'effect' &&
							statement.importKind !== 'type' &&
							Array.every(statement.specifiers, specifier => specifier.type === 'ImportSpecifier')
					),
					Option.flatMap(statement => {
						if (statement.type !== 'ImportDeclaration') return Option.none()
						return pipe(
							Array.findFirst(
								statement.specifiers,
								specifier => String.Order(importedName(specifier), 'Predicate') > 0
							),
							Option.map(specifier => input.fixer.insertTextBefore(specifier, 'Predicate, ')),
							Option.orElse(() =>
								Option.map(Array.last(statement.specifiers), specifier =>
									input.fixer.insertTextAfter(specifier, ', Predicate')
								)
							)
						)
					}),
					Option.map(Array.of)
				),
			onSome: variable =>
				Option.liftPredicate(Array.empty<Fix>(), () =>
					Array.some(
						variable.defs,
						definition =>
							definition.type === 'ImportBinding' &&
							definition.parent?.type === 'ImportDeclaration' &&
							definition.parent.source.value === 'effect' &&
							definition.parent.importKind !== 'type' &&
							definition.node.type === 'ImportSpecifier' &&
							definition.node.importKind !== 'type' &&
							definition.node.imported.type === 'Identifier' &&
							definition.node.imported.name === 'Predicate'
					)
				)
		})
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

export function typeWrapped(node: ESTree.Node) {
	if (
		node.type === 'TSAsExpression' ||
		node.type === 'TSInstantiationExpression' ||
		node.type === 'TSNonNullExpression' ||
		node.type === 'TSSatisfiesExpression' ||
		node.type === 'TSTypeAssertion'
	) {
		return Option.some(node.expression)
	}
	return Option.none()
}

// The outermost type assertion around a node, which is what its parent sees.
export function outermost(node: ESTree.Node): ESTree.Node {
	return pipe(
		Option.fromNullishOr(node.parent),
		Option.filter(parent => Option.isSome(typeWrapped(parent))),
		Option.match({onNone: () => node, onSome: outermost})
	)
}

export function returnedExpression(node: ESTree.Function | ESTree.ArrowFunctionExpression) {
	if (node.body === null) return
	if (node.body.type !== 'BlockStatement') return node.body
	if (node.body.body.length !== 1 || node.body.body[0]?.type !== 'ReturnStatement') return
	return node.body.body[0].argument
}

// The identifier a plain property chain such as `input.node.parent` starts from.
export function rootName(node: ESTree.Node): Option.Option<string> {
	if (node.type === 'Identifier') return Option.some(node.name)
	if (node.type === 'MemberExpression' && !node.computed && !node.optional) return rootName(node.object)
	return Option.none()
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

export function matches(regExp: RegExp) {
	return (text: string) => Option.isSome(pipe(text, String.match(regExp)))
}

export const isSchemaOperationName = matches(
	/^(?:(?:decode|encode)(?:Unknown)?(?:Effect|Exit|Option|Promise|Result|Sync)|asserts|is)$/u
)

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
	if (statement.type === 'ExportNamedDeclaration') return statement.declaration
	return statement
}

export function typeAlias(statement: ESTree.Statement | ESTree.ModuleDeclaration) {
	const declaration = statementDeclaration(statement)
	if (declaration?.type !== 'TSTypeAliasDeclaration') return Option.none()
	return Option.some(declaration)
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

function isSchemaCodecType(input: {context: Context; node: ESTree.TSType}) {
	return (
		schemaQualifiedType({context: input.context, node: input.node, propertyName: 'Codec'}) || schemaSchemaType(input)
	)
}

function typeArgumentName(node: ESTree.TSType) {
	if (node.type !== 'TSTypeReference' || node.typeArguments === null) return Option.none<string>()
	return pipe(
		Array.get(node.typeArguments.params, 0),
		Option.flatMap(parameter => {
			if (parameter.type !== 'TSTypeReference' || parameter.typeName.type !== 'Identifier') return Option.none<string>()
			return Option.some(parameter.typeName.name)
		})
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
		Option.flatMap(argument => {
			if (argument.type !== 'ArrowFunctionExpression' && argument.type !== 'FunctionExpression') return Option.none()
			return Option.fromNullishOr(argument.returnType)
		}),
		Option.filter(returnType => isSchemaCodecType({context: input.context, node: returnType.typeAnnotation})),
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
		if (node.typeName.type !== 'Identifier') return argumentNames
		return Array.prepend(argumentNames, node.typeName.name)
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

function annotationTypeNames(annotation?: ESTree.TSTypeAnnotation | null) {
	return pipe(
		Option.fromNullishOr(annotation),
		Option.map(present => referencedTypeNames(present.typeAnnotation)),
		Option.getOrElse(() => Array.empty<string>())
	)
}

function memberTypeNames(member: ESTree.TSSignature): string[] {
	if (member.type === 'TSIndexSignature') return referencedTypeNames(member.typeAnnotation.typeAnnotation)
	if (member.type === 'TSPropertySignature') return annotationTypeNames(member.typeAnnotation)
	return annotationTypeNames(member.returnType)
}

type NameEdges = {name: string; targets: string[]}

function isNode(value: unknown): value is ESTree.Node {
	return Predicate.hasProperty(value, 'type') && Predicate.isString(value.type)
}

export function childNodes(node: unknown) {
	if (!Predicate.isReadonlyObject(node)) return Array.empty<ESTree.Node>()
	return pipe(Record.values(Record.remove(node, 'parent')), Array.flatMap(Array.ensure), Array.filter(isNode))
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

function referenceNames(node: ESTree.Node): string[] {
	const nested = pipe(
		childNodes(node),
		Array.filter(
			child =>
				!(node.type === 'Property' && !node.computed && child === node.key) &&
				!(node.type === 'MemberExpression' && !node.computed && child === node.property)
		),
		Array.flatMap(referenceNames)
	)
	if (node.type !== 'Identifier') return nested
	return Array.prepend(nested, node.name)
}

function schemaEdges(statement: ESTree.Statement | ESTree.ModuleDeclaration) {
	const declaration = statementDeclaration(statement)
	if (declaration?.type === 'TSTypeAliasDeclaration') {
		if (isInferredType({name: declaration.id.name, node: declaration.typeAnnotation})) return Array.empty<NameEdges>()
		return [{name: declaration.id.name, targets: referencedTypeNames(declaration.typeAnnotation)}]
	}
	if (declaration?.type !== 'VariableDeclaration' || declaration.kind !== 'const') return Array.empty<NameEdges>()
	return Array.flatMap(declaration.declarations, declarator => {
		if (declarator.id.type !== 'Identifier' || declarator.init === null) return Array.empty<NameEdges>()
		return [{name: declarator.id.name, targets: referenceNames(declarator.init)}]
	})
}

export function schemaCycleNames(input: {context: Context; program: ESTree.Program}) {
	const seeds = suspendSeeds({context: input.context, node: input.program})
	if (Array.isArrayEmpty(seeds)) return Array.empty<string>()
	const edges = pipe(input.program.body, Array.flatMap(schemaEdges))
	const names = pipe(
		edges,
		Array.map(edge => edge.name),
		Array.dedupe
	)
	const graph = Graph.directed<string, 'reads'>(mutable => {
		const indices = Record.fromEntries(Array.map(names, name => [name, Graph.addNode(mutable, name)] as const))
		for (const edge of edges) {
			for (const target of edge.targets) {
				Option.zipWith(Record.get(indices, edge.name), Record.get(indices, target), (source, sink) =>
					Graph.addEdge(mutable, source, sink, 'reads')
				)
			}
		}
	})
	return pipe(
		Graph.stronglyConnectedComponents(graph),
		Array.map(component => Array.getSomes(Array.map(component, index => Graph.getNode(graph, index)))),
		Array.filter(
			component =>
				(component.length > 1 ||
					Array.some(edges, edge => Array.contains(component, edge.name) && Array.contains(edge.targets, edge.name))) &&
				Array.some(component, name => Array.contains(seeds, name))
		),
		Array.flatten
	)
}

function hasSingleStatementExpression(node: ESTree.Function | ESTree.ArrowFunctionExpression) {
	if (node.body === null) return false
	if (node.body.type !== 'BlockStatement') return true
	if (node.body.body.length !== 1) return false
	const statement = node.body.body[0]
	return (
		statement?.type === 'ExpressionStatement' || (statement?.type === 'ReturnStatement' && statement.argument !== null)
	)
}

export function bindingName(node: ESTree.Function | ESTree.ArrowFunctionExpression) {
	if (node.type === 'FunctionDeclaration') return Option.fromNullishOr(node.id?.name)
	if (node.parent.type === 'VariableDeclarator' && node.parent.id.type === 'Identifier') {
		return Option.some(node.parent.id.name)
	}
	return Option.none()
}

export function singleUseThunk(input: {context: Context; node: ESTree.Function | ESTree.ArrowFunctionExpression}) {
	if (
		input.node.params.length !== 0 ||
		input.node.typeParameters !== null ||
		!hasSingleStatementExpression(input.node)
	) {
		return false
	}
	return pipe(
		bindingName(input.node),
		Option.flatMap(name => variableFromScope({name, scope: input.context.sourceCode.getScope(input.node)})),
		Option.exists(variable => Array.filter(variable.references, reference => reference.isRead()).length === 1)
	)
}
