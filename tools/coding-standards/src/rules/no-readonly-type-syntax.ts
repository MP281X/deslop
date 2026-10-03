import {Array, MutableRef, Option, pipe} from 'effect'

import {defineRule} from '@oxlint/plugins'
import type {Context, ESTree} from '@oxlint/plugins'

import {importedMember, schemaCycleNames, statementDeclaration, variableFromScope} from '#rules/shared.ts'

function isTopLevelStatement(node: ESTree.TSTypeAliasDeclaration) {
	if (node.parent.type === 'Program') return true
	return node.parent.type === 'ExportNamedDeclaration' && node.parent.parent.type === 'Program'
}

function insideCycleType(input: {cycleNames: string[]; node: ESTree.Node}): boolean {
	if (input.node.type === 'Program') return false
	if (input.node.type === 'TSTypeAliasDeclaration' && isTopLevelStatement(input.node)) {
		return Array.contains(input.cycleNames, input.node.id.name)
	}
	return insideCycleType({cycleNames: input.cycleNames, node: input.node.parent})
}

function typeDeclarations(input: {context: Context; name: ESTree.TSTypeName}): ESTree.Node[] {
	if (input.name.type === 'Identifier') {
		return pipe(
			variableFromScope({name: input.name.name, scope: input.context.sourceCode.getScope(input.name)}),
			Option.flatMap(variable =>
				variable.scope.block.type === 'ClassDeclaration' &&
				Array.some(variable.defs, definition => definition.node === variable.scope.block)
					? variableFromScope({name: variable.name, scope: variable.scope.upper})
					: Option.some(variable)
			),
			Option.map(variable => Array.map(variable.defs, definition => definition.node)),
			Option.getOrElse(() => Array.empty<ESTree.Node>())
		)
	}
	if (input.name.type !== 'TSQualifiedName') return []
	const name = input.name
	return pipe(
		typeDeclarations({context: input.context, name: name.left}),
		Array.flatMap(declaration => {
			if (declaration.type !== 'TSModuleDeclaration' || declaration.body === null) return []
			return pipe(
				declaration.body.body,
				Array.map(statementDeclaration),
				Array.filter(node => node !== null)
			)
		}),
		Array.filter(
			declaration =>
				(declaration.type === 'TSTypeAliasDeclaration' || declaration.type === 'TSModuleDeclaration') &&
				declaration.id.type === 'Identifier' &&
				declaration.id.name === name.right.name
		)
	)
}

function shapeLiterals(input: {
	context: Context
	seen: ESTree.TSTypeAliasDeclaration[]
	type: ESTree.TSType
}): ESTree.TSType[] {
	if (input.type.type === 'TSTypeLiteral') return [input.type]
	if (input.type.type === 'TSUnionType' || input.type.type === 'TSIntersectionType') {
		return Array.flatMap(input.type.types, type => shapeLiterals({...input, type}))
	}
	if (input.type.type === 'TSParenthesizedType') return shapeLiterals({...input, type: input.type.typeAnnotation})
	if (input.type.type !== 'TSTypeReference') return []
	return pipe(
		typeDeclarations({context: input.context, name: input.type.typeName}),
		Array.filter(declaration => declaration.type === 'TSTypeAliasDeclaration'),
		Array.filter(alias => !Array.contains(input.seen, alias)),
		Array.flatMap(alias => shapeLiterals({...input, seen: Array.append(input.seen, alias), type: alias.typeAnnotation}))
	)
}

export const noReadonlyTypeSyntax = defineRule({
	create: context => {
		const cycleNames = schemaCycleNames({context, program: context.sourceCode.ast})
		const shapes = MutableRef.make(Array.empty<ESTree.TSType>())
		const properties = MutableRef.make(Array.empty<ESTree.TSPropertySignature>())
		const methods = MutableRef.make(Array.empty<ESTree.TSMethodSignature>())
		function exempt(node: ESTree.Node) {
			return insideCycleType({cycleNames, node})
		}
		return {
			CallExpression: node => {
				if (importedMember({context, importedName: 'Context', node: node.callee, propertyName: 'Service'})) {
					pipe(
						Option.fromNullishOr(node.typeArguments?.params[1]),
						Option.map(shape => MutableRef.update(shapes, Array.append(shape)))
					)
				}
			},
			'Program:exit': () => {
				const literals = pipe(
					MutableRef.get(shapes),
					Array.flatMap(shape => shapeLiterals({context, seen: [], type: shape}))
				)
				function inShape(node: ESTree.Node) {
					return Array.some(literals, literal => literal === node.parent)
				}
				for (const node of MutableRef.get(properties)) {
					if (inShape(node) && !node.readonly) {
						context.report({message: 'Mark this service property readonly.', node})
					}
					if (!inShape(node) && node.readonly && !exempt(node)) {
						context.report({message: 'Remove the readonly property modifier.', node})
					}
				}
				for (const node of MutableRef.get(methods)) {
					if (inShape(node)) {
						context.report({message: 'Write this service method as a readonly property holding a function.', node})
					}
				}
			},
			TSIndexSignature: node => {
				if (node.readonly) context.report({message: 'Remove the readonly index modifier.', node})
			},
			TSMappedType: node => {
				if (node.readonly === true || node.readonly === '+') {
					context.report({message: 'Remove the readonly mapped-type modifier.', node})
				}
			},
			TSMethodSignature: node => {
				MutableRef.update(methods, Array.append(node))
			},
			TSPropertySignature: node => {
				MutableRef.update(properties, Array.append(node))
			},
			TSTypeOperator: node => {
				if (node.operator === 'readonly' && !exempt(node)) {
					context.report({message: 'Use a mutable type shape.', node})
				}
			},
			TSTypeReference: node => {
				if (node.typeName.type === 'Identifier' && node.typeName.name === 'Readonly' && !exempt(node)) {
					context.report({message: 'Use a mutable type shape.', node})
				}
			}
		}
	},
	meta: {type: 'problem'}
})
